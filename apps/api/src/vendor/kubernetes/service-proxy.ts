import type http from 'node:http';
import type { Readable } from 'node:stream';

/** A cluster-internal Service reached through the API server's proxy. */
export interface ServiceTarget {
  service: string;
  namespace: string;
  port: string;
}

export interface ServiceProxyRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** Path on the Service, already encoded, starting with `/`. */
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Written as the request body; a stream is piped without buffering. */
  body?: Buffer | Readable | ((request: http.ClientRequest) => void);
  /** Aborts the request when no response arrives in time. */
  timeoutMs?: number;
}

/**
 * Splits an in-cluster address such as `name.namespace:port` into the Service
 * the API server proxies to. The namespace and port fall back to the given
 * defaults when the address leaves them out.
 */
export const parseServiceAddress = (
  address: string,
  fallbackNamespace: string,
  fallbackPort: string,
): ServiceTarget => {
  const [host, port = fallbackPort] = address.split(':');
  const [service, namespace = fallbackNamespace] = host.split('.');

  return { service, namespace, port: port || fallbackPort };
};

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
