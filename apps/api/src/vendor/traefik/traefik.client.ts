import { request } from 'node:https';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  TRAEFIK_GROUP,
  TRAEFIK_VERSION,
  traefikPlural,
  type TraefikKind,
  type TraefikObject,
} from './traefik.manifests';

export const TRAEFIK_NAMESPACE = 'kube-system';
export const TRAEFIK_NAME = 'traefik';
const PROBE_TIMEOUT_MS = 5000;

export const TRAEFIK_MISSING_MESSAGE =
  'The Traefik ingress controller is not running in this cluster, so a domain cannot be served.';
export const ACME_MISSING_MESSAGE =
  'HTTPS certificates are not configured. Re-run the installer once to enable them, then try again.';

export interface ProbeResult {
  ok: boolean;
  error?: string;
}

/** Lookup failures that mean the in-cluster service name is unknown here. */
const UNRESOLVED_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

/**
 * Where a probe connects. In the cluster it goes through the Traefik service,
 * which avoids NAT hairpinning on the server's public IP. Outside it (the API
 * run from source against a remote cluster) the service name does not
 * resolve, so it goes to the hostname itself, which reaches the same Traefik
 * through public DNS. `TRAEFIK_SERVICE_HOST` overrides both.
 */
export const probeTarget = (
  hostname: string,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const configured = env.TRAEFIK_SERVICE_HOST?.trim();

  if (configured) {
    return configured;
  }

  return env.KUBERNETES_SERVICE_HOST
    ? `${TRAEFIK_NAME}.${TRAEFIK_NAMESPACE}.svc.cluster.local`
    : hostname;
};

export interface ProbeOptions {
  /** Request path; `/` when omitted. */
  path?: string;
  /**
   * When set, only this status counts as success. Otherwise any response does:
   * a completed TLS handshake already proves the certificate is trusted.
   */
  expectStatus?: number;
}

/**
 * Talks to k3s's bundled Traefik: checks it can issue certificates, writes
 * IngressRoutes and Middlewares, and probes hostnames over HTTPS.
 */
@Injectable()
export class TraefikClient {
  private readonly logger = new Logger(TraefikClient.name);

  constructor(private readonly kubernetes: KubernetesService) {}

  /** Throws 409 when the cluster cannot serve a hostname with HTTPS. */
  async assertAvailable(): Promise<void> {
    await this.requireObject(
      () =>
        this.kubernetes.coreV1.readNamespacedService({
          name: TRAEFIK_NAME,
          namespace: TRAEFIK_NAMESPACE,
        }),
      TRAEFIK_MISSING_MESSAGE,
    );
    // The installer writes this HelmChartConfig with the ACME resolver.
    await this.requireObject(
      () =>
        this.kubernetes.customObjects.getNamespacedCustomObject({
          group: 'helm.cattle.io',
          version: 'v1',
          namespace: TRAEFIK_NAMESPACE,
          plural: 'helmchartconfigs',
          name: TRAEFIK_NAME,
        }),
      ACME_MISSING_MESSAGE,
    );
  }

  /** Creates the object, or replaces it when it already exists. */
  async upsert(body: TraefikObject): Promise<void> {
    const target = {
      group: TRAEFIK_GROUP,
      version: TRAEFIK_VERSION,
      namespace: body.metadata.namespace,
      plural: traefikPlural(body.kind),
    };

    try {
      const existing =
        (await this.kubernetes.customObjects.getNamespacedCustomObject({
          ...target,
          name: body.metadata.name,
        })) as { metadata?: { resourceVersion?: string } };
      await this.kubernetes.customObjects.replaceNamespacedCustomObject({
        ...target,
        name: body.metadata.name,
        body: {
          ...body,
          metadata: {
            ...body.metadata,
            resourceVersion: existing.metadata?.resourceVersion,
          },
        },
      });
      return;
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        this.logger.warn(
          `Could not update ${body.kind} ${body.metadata.name}: ${String(error)}`,
        );
        throw toNestException(error);
      }
    }

    try {
      await this.kubernetes.customObjects.createNamespacedCustomObject({
        ...target,
        body,
      });
    } catch (error) {
      throw toNestException(error);
    }
  }

  /** Deletes the object; a missing one is ignored. */
  async delete(kind: TraefikKind, namespace: string, name: string) {
    try {
      await this.kubernetes.customObjects.deleteNamespacedCustomObject({
        group: TRAEFIK_GROUP,
        version: TRAEFIK_VERSION,
        namespace,
        plural: traefikPlural(kind),
        name,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw toNestException(error);
      }
    }
  }

  /**
   * Requests `https://<hostname><path>` with SNI and the Host header set to
   * the hostname, so it succeeds only once a trusted certificate for that
   * hostname is served. When the chosen target does not resolve, the
   * hostname itself is tried.
   */
  async probe(
    hostname: string,
    options: ProbeOptions = {},
  ): Promise<ProbeResult> {
    const target = probeTarget(hostname);
    const result = await this.request(target, hostname, options);

    if (result.ok || target === hostname || !result.unresolved) {
      return { ok: result.ok, error: result.error };
    }

    const direct = await this.request(hostname, hostname, options);
    return { ok: direct.ok, error: direct.error };
  }

  private request(
    host: string,
    hostname: string,
    options: ProbeOptions,
  ): Promise<ProbeResult & { unresolved?: boolean }> {
    return new Promise((resolve) => {
      const req = request(
        {
          host,
          port: 443,
          path: options.path ?? '/',
          method: 'GET',
          servername: hostname,
          headers: { Host: hostname },
          rejectUnauthorized: true,
          timeout: PROBE_TIMEOUT_MS,
        },
        (res) => {
          res.resume();
          const ok =
            options.expectStatus === undefined ||
            res.statusCode === options.expectStatus;
          resolve(
            ok ? { ok } : { ok, error: `Unexpected status ${res.statusCode}` },
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', (error: NodeJS.ErrnoException) =>
        resolve({
          ok: false,
          error: error.message,
          unresolved: UNRESOLVED_CODES.has(error.code ?? ''),
        }),
      );
      req.end();
    });
  }

  private async requireObject(
    read: () => Promise<unknown>,
    missingMessage: string,
  ): Promise<void> {
    try {
      await read();
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        throw new ConflictException(missingMessage);
      }
      throw toNestException(error);
    }
  }
}
