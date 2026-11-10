import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  parseServiceAddress,
  type ServiceProxyRequest,
  type ServiceTarget,
} from '@/vendor/kubernetes/service-proxy';

export { readBody } from '@/vendor/kubernetes/service-proxy';

export const DEFAULT_FILER_ADDRESS = 'seaweedfs-filer.seaweedfs:8888';

export type FilerRequest = ServiceProxyRequest;

export type FilerTarget = ServiceTarget;

/**
 * `seaweedfs-filer.seaweedfs:8888` (the same value the CSI driver and the
 * shell Jobs use) split into the Service the API server proxies to.
 */
export const parseFilerAddress = (
  address: string,
  fallbackNamespace: string,
): FilerTarget => parseServiceAddress(address, fallbackNamespace, '8888');

/** Encodes every segment of a filer path and keeps the slashes. */
export const encodeFilerPath = (path: string): string =>
  path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export interface FilerUpload {
  request: FilerRequest;
  /** Bytes read from the body so far. */
  bytes: () => number;
}

/**
 * A `POST` that streams `body` to the filer as one multipart part, so a file
 * of any size passes through without being held in memory. An existing file
 * at `path` is replaced.
 */
export const filerUpload = (
  path: string,
  name: string,
  contentType: string,
  body: Readable,
): FilerUpload => {
  const boundary = `acceleratio-${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${name.replace(/["\\\r\n]/g, '_')}"\r\n` +
      `Content-Type: ${contentType.replace(/[\r\n]/g, '')}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  let size = 0;

  return {
    bytes: () => size,
    request: {
      method: 'POST',
      path,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: (request) => {
        request.write(head);
        body.on('data', (chunk: Buffer) => {
          size += chunk.length;

          if (!request.write(chunk)) {
            body.pause();
            request.once('drain', () => body.resume());
          }
        });
        body.on('end', () => request.end(tail));
        body.on('error', (error) => request.destroy(error));
      },
    },
  };
};

/**
 * The SeaweedFS filer HTTP API, reached through the Kubernetes API server's
 * service proxy (see `KubernetesService.proxyServiceRequest`). S3 itself
 * cannot go this way: SigV4 signs the host and path, which the proxy
 * rewrites.
 */
@Injectable()
export class SeaweedfsFilerClient {
  constructor(private readonly kubernetes: KubernetesService) {}

  private get target(): FilerTarget {
    return parseFilerAddress(
      process.env.SEAWEEDFS_FILER?.trim() || DEFAULT_FILER_ADDRESS,
      process.env.SEAWEEDFS_NAMESPACE?.trim() || 'seaweedfs',
    );
  }

  /**
   * Sends one request and resolves with the response once its headers
   * arrive. The caller reads or pipes the body and must consume it.
   */
  request(input: FilerRequest): Promise<http.IncomingMessage> {
    return this.kubernetes.proxyServiceRequest(this.target, input);
  }
}
