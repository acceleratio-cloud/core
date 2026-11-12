import { Readable } from 'node:stream';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { S3BucketEntry, S3BucketListing } from '@acceleratio/shared';
import { S3StorageClient } from '@/vendor/s3/s3.client';
import { normalizeObjectPath, normalizePrefix } from './s3-bucket.config';
import { S3BucketWorkloadService } from './s3-bucket.service';

/** Entries one listing returns; S3 pages beyond it. */
export const LISTING_LIMIT = 1000;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export interface BucketDownload {
  name: string;
  contentType: string;
  contentLength: number | null;
  body: Readable;
}

const lastSegment = (path: string): string =>
  path.replace(/\/+$/, '').split('/').pop() ?? path;

const folderEntry = (path: string): S3BucketEntry => ({
  name: lastSegment(path),
  path,
  kind: 'folder',
  size: null,
  content_type: null,
  modified_at: null,
});

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
 * Browsing and editing a bucket's contents for the console, over S3 with the
 * admin key: folders are key prefixes (and the empty `<folder>/` objects the
 * console creates for empty ones), so what the console writes is what S3
 * clients see. Authorization is the console's: the project scope of the
 * bucket workload.
 */
@Injectable()
export class S3BucketObjectsService {
  constructor(
    private readonly buckets: S3BucketWorkloadService,
    private readonly s3: S3StorageClient,
  ) {}

  async list(
    projectId: string,
    id: string,
    prefixInput: unknown,
  ): Promise<S3BucketListing> {
    const bucket = await this.buckets.readyBucket(projectId, id);
    const prefix = normalizePrefix(prefixInput);
    const page = await this.s3.list(bucket, prefix, {
      delimiter: '/',
      maxKeys: LISTING_LIMIT,
    });
    const folders = (page.CommonPrefixes ?? []).flatMap((item) =>
      item.Prefix ? [folderEntry(item.Prefix)] : [],
    );
    const files = (page.Contents ?? []).flatMap((item): S3BucketEntry[] =>
      // The folder's own marker object is the folder, not a file in it.
      item.Key && item.Key !== prefix
        ? [
            {
              name: lastSegment(item.Key),
              path: item.Key,
              kind: 'file',
              size: item.Size ?? 0,
              content_type: null,
              modified_at: item.LastModified?.toISOString() ?? null,
            },
          ]
        : [],
    );

    if (prefix && folders.length === 0 && (page.Contents ?? []).length === 0) {
      throw new NotFoundException('Folder not found');
    }

    return {
      prefix,
      entries: sortEntries([...folders, ...files]),
      truncated: page.IsTruncated === true,
    };
  }

  async createFolder(
    projectId: string,
    id: string,
    pathInput: unknown,
  ): Promise<S3BucketEntry> {
    const bucket = await this.buckets.readyBucket(projectId, id);
    const path = normalizeObjectPath(pathInput, 'folder');

    if (
      (await this.s3.head(bucket, path.slice(0, -1))) !== null ||
      (await this.folderExists(bucket, path))
    ) {
      throw new ConflictException('A file or folder with this name exists');
    }

    // An empty object named `<folder>/` keeps an empty folder visible.
    await this.s3.put(bucket, path, Buffer.alloc(0), DEFAULT_CONTENT_TYPE);

    return { ...folderEntry(path), modified_at: new Date().toISOString() };
  }

  /** Streams the request body to S3; an existing file is replaced. */
  async upload(
    projectId: string,
    id: string,
    pathInput: unknown,
    body: Readable,
    contentType: string | undefined,
  ): Promise<S3BucketEntry> {
    const bucket = await this.buckets.readyBucket(projectId, id);
    const path = normalizeObjectPath(pathInput, 'file');
    const type = contentType?.trim() || DEFAULT_CONTENT_TYPE;
    const size = await this.s3.put(bucket, path, body, type);

    return {
      name: lastSegment(path),
      path,
      kind: 'file',
      size,
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
    const object = await this.s3.get(bucket, path);

    if (object === null || !(object.Body instanceof Readable)) {
      if (object === null && (await this.folderExists(bucket, `${path}/`))) {
        throw new BadRequestException('This path is a folder');
      }

      throw new NotFoundException('File not found');
    }

    return {
      name: lastSegment(path),
      contentType: object.ContentType || DEFAULT_CONTENT_TYPE,
      contentLength: object.ContentLength ?? null,
      body: object.Body,
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

    if (kind === 'folder') {
      if ((await this.s3.deletePrefix(bucket, path)) === 0) {
        throw new NotFoundException('Folder not found');
      }

      return;
    }

    if ((await this.s3.head(bucket, path)) === null) {
      throw new NotFoundException('File not found');
    }

    await this.s3.delete(bucket, path);
  }

  private async folderExists(bucket: string, prefix: string): Promise<boolean> {
    const page = await this.s3.list(bucket, prefix, { maxKeys: 1 });

    return (page.Contents ?? []).length > 0;
  }
}
