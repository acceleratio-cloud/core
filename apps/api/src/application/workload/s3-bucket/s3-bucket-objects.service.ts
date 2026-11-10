import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { S3BucketEntry, S3BucketListing } from '@acceleratio/shared';
import {
  encodeFilerPath,
  filerUpload,
  readBody,
  SeaweedfsFilerClient,
} from '@/vendor/seaweedfs/seaweedfs-filer.client';
import { normalizeObjectPath, normalizePrefix } from './s3-bucket.config';
import { S3BucketWorkloadService } from './s3-bucket.service';

/** Entries one listing returns; the filer pages beyond it. */
export const LISTING_LIMIT = 1000;
/** Go's `os.ModeDir`, which the filer reports in `Mode`. */
const MODE_DIR = 2 ** 31;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

interface FilerEntry {
  FullPath: string;
  Mtime?: string;
  Mode: number;
  Mime?: string;
  FileSize?: number;
}

interface FilerListing {
  Entries: FilerEntry[] | null;
  ShouldDisplayLoadMore?: boolean;
}

export interface BucketDownload {
  name: string;
  contentType: string;
  contentLength: number | null;
  body: Readable;
}

const isFolder = (entry: Pick<FilerEntry, 'Mode'>): boolean =>
  Math.floor(entry.Mode / MODE_DIR) % 2 === 1;

const lastSegment = (path: string): string =>
  path.replace(/\/+$/, '').split('/').pop() ?? path;

/** Maps one filer entry under `/buckets/<bucket>/` to an explorer entry. */
export const toBucketEntry = (
  bucket: string,
  entry: FilerEntry,
): S3BucketEntry => {
  const root = `/buckets/${bucket}/`;
  const key = entry.FullPath.startsWith(root)
    ? entry.FullPath.slice(root.length)
    : lastSegment(entry.FullPath);
  const folder = isFolder(entry);

  return {
    name: lastSegment(key),
    path: folder ? `${key}/` : key,
    kind: folder ? 'folder' : 'file',
    size: folder ? null : (entry.FileSize ?? 0),
    content_type: folder ? null : entry.Mime || null,
    modified_at: entry.Mtime ?? null,
  };
};

/** Folders first, then files, each in natural name order. */
export const sortEntries = (entries: S3BucketEntry[]): S3BucketEntry[] =>
  [...entries].sort(
    (left, right) =>
      Number(right.kind === 'folder') - Number(left.kind === 'folder') ||
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
  );

/** Quotes a file name for Content-Disposition, with an RFC 5987 fallback. */
export const contentDisposition = (name: string): string => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

/**
 * Browsing and editing a bucket's contents for the console. Requests go to
 * the SeaweedFS filer, whose folders and files are the bucket's prefixes and
 * objects, so what the console writes is what S3 clients see. Authorization
 * is the console's: the project scope of the bucket workload.
 */
@Injectable()
export class S3BucketObjectsService {
  private readonly logger = new Logger(S3BucketObjectsService.name);

  constructor(
    private readonly buckets: S3BucketWorkloadService,
    private readonly filer: SeaweedfsFilerClient,
  ) {}

  async list(
    projectId: string,
    id: string,
    prefixInput: unknown,
  ): Promise<S3BucketListing> {
    const bucket = await this.buckets.readyBucket(projectId, id);
    const prefix = normalizePrefix(prefixInput);
    const response = await this.send(() =>
      this.filer.request({
        method: 'GET',
        path: this.filerPath(bucket, prefix),
        query: { limit: String(LISTING_LIMIT) },
        headers: { Accept: 'application/json' },
      }),
    );

    if (response.statusCode === 404) {
      response.resume();
      throw new NotFoundException('Folder not found');
    }

    const listing = JSON.parse(
      await this.expectOk(response, 'list the folder'),
    ) as FilerListing;

    return {
      prefix,
      entries: sortEntries(
        (listing.Entries ?? []).map((entry) => toBucketEntry(bucket, entry)),
      ),
      truncated: listing.ShouldDisplayLoadMore === true,
    };
  }

  async createFolder(
    projectId: string,
    id: string,
    pathInput: unknown,
  ): Promise<S3BucketEntry> {
    const bucket = await this.buckets.readyBucket(projectId, id);
    const path = normalizeObjectPath(pathInput, 'folder');

    await this.ensureFree(bucket, path.slice(0, -1));

    const response = await this.send(() =>
      this.filer.request({
        method: 'POST',
        path: this.filerPath(bucket, path),
        query: { op: 'mkdir' },
      }),
    );

    await this.expectOk(response, 'create the folder');

    return {
      name: lastSegment(path),
      path,
      kind: 'folder',
      size: null,
      content_type: null,
      modified_at: new Date().toISOString(),
    };
  }

  /** Streams the request body to the filer; an existing file is replaced, as S3 does. */
  async upload(
    projectId: string,
    id: string,
    pathInput: unknown,
    body: Readable,
    contentType: string | undefined,
  ): Promise<S3BucketEntry> {
    const bucket = await this.buckets.readyBucket(projectId, id);
    const path = normalizeObjectPath(pathInput, 'file');
    const name = lastSegment(path);
    const type = contentType?.trim() || DEFAULT_CONTENT_TYPE;
    const upload = filerUpload(this.filerPath(bucket, path), name, type, body);
    const response = await this.send(() => this.filer.request(upload.request));

    const stored = await this.expectOk(response, 'upload the file');
    let storedSize: unknown;

    try {
      storedSize = (JSON.parse(stored) as { size?: unknown }).size;
    } catch {
      storedSize = undefined;
    }

    return {
      name,
      path,
      kind: 'file',
      // The filer reports what it stored; the byte count is the fallback.
      size: typeof storedSize === 'number' ? storedSize : upload.bytes(),
      content_type: type,
      modified_at: new Date().toISOString(),
    };
  }

  async download(
    projectId: string,
    id: string,
    pathInput: unknown,
  ): Promise<BucketDownload> {
    const bucket = await this.buckets.readyBucket(projectId, id);
    const path = normalizeObjectPath(pathInput, 'file');
    const entry = await this.stat(bucket, path);

    if (entry === null) {
      throw new NotFoundException('File not found');
    }

    // A folder would answer with the filer's HTML listing.
    if (isFolder(entry)) {
      throw new BadRequestException('This path is a folder');
    }

    const response = await this.send(() =>
      this.filer.request({ method: 'GET', path: this.filerPath(bucket, path) }),
    );

    if (response.statusCode === 404) {
      response.resume();
      throw new NotFoundException('File not found');
    }

    if ((response.statusCode ?? 500) >= 300) {
      await this.expectOk(response, 'download the file');
    }

    const length = Number(response.headers['content-length']);

    return {
      name: lastSegment(path),
      contentType: response.headers['content-type'] || DEFAULT_CONTENT_TYPE,
      contentLength: Number.isFinite(length) ? length : null,
      body: response,
    };
  }

  /** Deletes a file, or a folder with everything in it. */
  async remove(
    projectId: string,
    id: string,
    pathInput: unknown,
    kind: 'file' | 'folder',
  ): Promise<void> {
    const bucket = await this.buckets.readyBucket(projectId, id);
    const path = normalizeObjectPath(pathInput, kind);
    const response = await this.send(() =>
      this.filer.request({
        method: 'DELETE',
        path: this.filerPath(bucket, path),
        query: kind === 'folder' ? { recursive: 'true' } : {},
      }),
    );

    if (response.statusCode === 404) {
      response.resume();
      throw new NotFoundException(
        kind === 'folder' ? 'Folder not found' : 'File not found',
      );
    }

    await this.expectOk(response, `delete the ${kind}`);
  }

  /** A folder may not take the key of an existing file or folder. */
  private async ensureFree(bucket: string, key: string): Promise<void> {
    if ((await this.stat(bucket, key)) !== null) {
      throw new ConflictException('A file or folder with this name exists');
    }
  }

  /** The filer entry at a key, or null when nothing is there. */
  private async stat(bucket: string, key: string): Promise<FilerEntry | null> {
    const response = await this.send(() =>
      this.filer.request({
        method: 'GET',
        path: this.filerPath(bucket, key),
        query: { metadata: 'true' },
        headers: { Accept: 'application/json' },
      }),
    );

    if (response.statusCode === 404) {
      response.resume();
      return null;
    }

    return JSON.parse(
      await this.expectOk(response, 'read the entry'),
    ) as FilerEntry;
  }

  private filerPath(bucket: string, key: string): string {
    return `/buckets/${bucket}/${encodeFilerPath(key)}`;
  }

  private async send(
    run: () => Promise<IncomingMessage>,
  ): Promise<IncomingMessage> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(
        `SeaweedFS filer request failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw new BadGatewayException('SeaweedFS could not be reached');
    }
  }

  /** Resolves with the body of a 2xx response, or throws a 502. */
  private async expectOk(
    response: IncomingMessage,
    action: string,
  ): Promise<string> {
    const status = response.statusCode ?? 500;
    const text = await readBody(response);

    if (status >= 200 && status < 300) {
      return text;
    }

    this.logger.warn(
      `Filer could not ${action}: ${status} ${text.slice(0, 300)}`,
    );

    throw new BadGatewayException(`SeaweedFS could not ${action}`);
  }
}
