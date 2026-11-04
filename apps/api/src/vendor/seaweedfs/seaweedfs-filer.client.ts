import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';

export const DEFAULT_FILER_ADDRESS = 'seaweedfs-filer.seaweedfs:8888';

export interface FilerRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** Filer path, already encoded, starting with `/`. */
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Written as the request body; a stream is piped without buffering. */
  body?: Buffer | Readable | ((request: http.ClientRequest) => void);
}

export interface FilerTarget {
  service: string;
  namespace: string;
  port: string;
}

/**
 * `seaweedfs-filer.seaweedfs:8888` (the same value the CSI driver and the
 * shell Jobs use) split into the Service the API server proxies to.
 */
export const parseFilerAddress = (
  address: string,
  fallbackNamespace: string,
): FilerTarget => {
  const [host, port = '8888'] = address.split(':');
  const [service, namespace = fallbackNamespace] = host.split('.');

  return { service, namespace, port };
};

/** Encodes every segment of a filer path and keeps the slashes. */
export const encodeFilerPath = (path: string): string =>
  path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

/**
 * The SeaweedFS filer HTTP API, reached through the Kubernetes API server's
 * service proxy. The API runs outside the cluster in development and the
 * filer is a cluster-internal Service; the proxy reuses the kubeconfig
 * credentials the API already holds, so no port is exposed. S3 itself cannot
 * go this way: SigV4 signs the host and path, which the proxy rewrites.
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
  async request(input: FilerRequest): Promise<http.IncomingMessage> {
    const cluster = this.kubernetes.config.getCurrentCluster();

    if (!cluster) {
      throw new Error('The kubeconfig has no current cluster');
    }

    const { service, namespace, port } = this.target;
    const url = new URL(
      `${cluster.server.replace(/\/+$/, '')}/api/v1/namespaces/${namespace}/services/${service}:${port}/proxy${input.path}`,
    );

    for (const [key, value] of Object.entries(input.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const options: https.RequestOptions = {
      method: input.method,
      headers: { ...input.headers },
    };

    // Adds the client certificate, CA, token or exec credentials.
    await this.kubernetes.config.applyToHTTPSOptions(options);

    const transport = url.protocol === 'http:' ? http : https;

    return new Promise((resolve, reject) => {
      const request = transport.request(url, options, resolve);

      request.on('error', reject);

      if (input.body === undefined) {
        request.end();
      } else if (Buffer.isBuffer(input.body)) {
        request.end(input.body);
      } else if (typeof input.body === 'function') {
        input.body(request);
      } else {
        input.body.on('error', (error) => request.destroy(error));
        input.body.pipe(request);
      }
    });
  }
}

/** Reads a whole (small) response body as text. */
export const readBody = async (
  response: http.IncomingMessage,
): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }

  return Buffer.concat(chunks).toString('utf8');
};
