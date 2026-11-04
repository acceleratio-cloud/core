import type http from 'node:http';
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
