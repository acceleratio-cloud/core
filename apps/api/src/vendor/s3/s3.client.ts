import type { Readable } from 'node:stream';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  rustfsAdminSecret,
  rustfsApiEndpoint,
  rustfsNamespace,
  S3_REGION,
} from './rustfs';

/** DeleteObjects takes at most this many keys. */
const DELETE_BATCH = 1000;

const statusOf = (error: unknown): number | undefined =>
  (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;

/** True for "no such key/bucket" answers, which callers treat as absence. */
export const isS3NotFound = (error: unknown): boolean =>
  statusOf(error) === 404 ||
  ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(
    (error as { name?: string })?.name ?? '',
  );

/**
 * S3 access to RustFS with the admin key from the Secret the installer
 * writes. The client is built on first use and rebuilt after a failure to
 * read the Secret, so a fresh cluster does not need an API restart.
 */
@Injectable()
export class S3StorageClient {
  private readonly logger = new Logger(S3StorageClient.name);
  private client: Promise<S3Client> | null = null;

  constructor(private readonly kubernetes: KubernetesService) {}

  private s3(): Promise<S3Client> {
    this.client ??= this.build().catch((error: unknown) => {
      this.client = null;
      throw error;
    });

    return this.client;
  }

  private async build(): Promise<S3Client> {
    const secret = await this.kubernetes.coreV1.readNamespacedSecret({
      name: rustfsAdminSecret(),
      namespace: rustfsNamespace(),
    });
    const read = (key: string) =>
      Buffer.from(secret.data?.[key] ?? '', 'base64').toString('utf8');
    const accessKeyId = read('RUSTFS_ACCESS_KEY');
    const secretAccessKey = read('RUSTFS_SECRET_KEY');

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('The RustFS admin Secret has no keys');
    }

    return new S3Client({
      endpoint: rustfsApiEndpoint(),
      region: S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      // Checksums only where S3 requires them, as most S3-compatible stores expect.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /**
   * Runs one request. "Not found" is the caller's to interpret; anything
   * else (RustFS down, the Secret missing, a 5xx) is a 502 for the console.
   */
  private async run<T>(
    action: string,
    request: (client: S3Client) => Promise<T>,
  ): Promise<T> {
    try {
      return await request(await this.s3());
    } catch (error) {
      if (isS3NotFound(error)) {
        throw error;
      }

      this.logger.warn(
        `S3 request to ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw new BadGatewayException(`Object storage could not ${action}`);
    }
  }

  /** One page of keys under `prefix`; with `/` as delimiter, folders come as CommonPrefixes. */
  list(
    bucket: string,
    prefix: string,
    options: { delimiter?: string; maxKeys?: number; token?: string } = {},
  ): Promise<ListObjectsV2CommandOutput> {
    return this.run('list the folder', (client) =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          Delimiter: options.delimiter,
          MaxKeys: options.maxKeys,
          ContinuationToken: options.token,
        }),
      ),
    );
  }

  /** The object's metadata, or null when there is no object at `key`. */
  async head(
    bucket: string,
    key: string,
  ): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.run('read the file', (client) =>
        client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
      );
    } catch (error) {
      if (isS3NotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  /** The object with its body as a stream, or null when it does not exist. */
  async get(
    bucket: string,
    key: string,
  ): Promise<GetObjectCommandOutput | null> {
    try {
      return await this.run('download the file', (client) =>
        client.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
      );
    } catch (error) {
      if (isS3NotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Streams `body` to `key` (multipart above 5 MiB), replacing an existing
   * object. Resolves with the number of bytes stored.
   */
  put(
    bucket: string,
    key: string,
    body: Readable | Buffer,
    contentType: string,
  ): Promise<number> {
    return this.run('upload the file', async (client) => {
      let size = Buffer.isBuffer(body) ? body.length : 0;
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        },
      });

      upload.on('httpUploadProgress', (progress) => {
        size = Math.max(size, progress.loaded ?? 0);
      });
      await upload.done();

      return size;
    });
  }

  /** Deletes one object; a missing one is not an error, as in S3. */
  async delete(bucket: string, key: string): Promise<void> {
    await this.run('delete the file', (client) =>
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    );
  }

  /** Deletes every object whose key starts with `prefix`; resolves with how many. */
  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;

    do {
      const page = await this.list(bucket, prefix, {
        maxKeys: DELETE_BATCH,
        token,
      });
      const keys = (page.Contents ?? []).flatMap((item) =>
        item.Key ? [{ Key: item.Key }] : [],
      );

      if (keys.length > 0) {
        const result = await this.run('delete the files', (client) =>
          client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: keys, Quiet: true },
            }),
          ),
        );

        if (result.Errors?.length) {
          throw new BadGatewayException(
            `Object storage could not delete ${result.Errors[0].Key ?? 'a file'}`,
          );
        }

        deleted += keys.length;
      }

      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    return deleted;
  }
}
