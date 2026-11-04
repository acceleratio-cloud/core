import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  API_PATH,
  buildIngressRoutes,
  buildMiddlewares,
  httpRouteName,
  INGRESS_ROUTE_PLURAL,
  MIDDLEWARE_PLURAL,
  TRAEFIK_GROUP,
  TRAEFIK_VERSION,
  type TraefikObject,
} from './control-plane.manifests';

const SERVICE_ACCOUNT_NAMESPACE_FILE =
  '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
const DEFAULT_NAMESPACE = 'acceleratio';
const TRAEFIK_NAMESPACE = 'kube-system';
const TRAEFIK_NAME = 'traefik';
const PROBE_TIMEOUT_MS = 5000;

export const TRAEFIK_MISSING_MESSAGE =
  'The Traefik ingress controller is not running in this cluster, so a custom URL cannot be served.';
export const ACME_MISSING_MESSAGE =
  'HTTPS certificates are not configured. Re-run the installer once to enable them, then apply again.';

export interface ProbeResult {
  ok: boolean;
  error?: string;
}

const readNamespace = (): string => {
  const configured = process.env.ACCELERATIO_NAMESPACE?.trim();
  if (configured) {
    return configured;
  }
  try {
    return readFileSync(SERVICE_ACCOUNT_NAMESPACE_FILE, 'utf8').trim();
  } catch {
    return DEFAULT_NAMESPACE;
  }
};

/**
 * Publishes the control plane on a hostname through k3s's bundled Traefik and
 * checks that the hostname serves the API over valid HTTPS.
 */
@Injectable()
export class ControlPlaneRoutingService {
  private readonly logger = new Logger(ControlPlaneRoutingService.name);
  readonly namespace = readNamespace();

  constructor(private readonly kubernetes: KubernetesService) {}

  /** Throws 409 when the cluster cannot serve a custom URL with HTTPS. */
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

  /** Creates or updates the middlewares and the routes `name` for `hostname`. */
  async publish(name: string, hostname: string): Promise<void> {
    const objects = [
      ...buildMiddlewares(this.namespace),
      ...buildIngressRoutes(name, this.namespace, hostname),
    ];
    for (const body of objects) {
      await this.upsert(body);
    }
  }

  /** Deletes the routes `name`; missing objects are ignored. */
  async unpublish(name: string): Promise<void> {
    for (const routeName of [name, httpRouteName(name)]) {
      try {
        await this.kubernetes.customObjects.deleteNamespacedCustomObject({
          group: TRAEFIK_GROUP,
          version: TRAEFIK_VERSION,
          namespace: this.namespace,
          plural: INGRESS_ROUTE_PLURAL,
          name: routeName,
        });
      } catch (error) {
        if (getKubernetesStatusCode(error) !== 404) {
          throw toNestException(error);
        }
      }
    }
  }

  /**
   * Requests `https://<hostname>/api/healthz` through the in-cluster Traefik
   * service with SNI set to the hostname, so it succeeds only once a trusted
   * certificate is served. Going through the service avoids NAT hairpinning
   * on the server's public IP.
   */
  probe(hostname: string): Promise<ProbeResult> {
    const host =
      process.env.TRAEFIK_SERVICE_HOST?.trim() ||
      `${TRAEFIK_NAME}.${TRAEFIK_NAMESPACE}.svc.cluster.local`;

    return new Promise((resolve) => {
      const req = request(
        {
          host,
          port: 443,
          path: `${API_PATH}/healthz`,
          method: 'GET',
          servername: hostname,
          headers: { Host: hostname },
          rejectUnauthorized: true,
          timeout: PROBE_TIMEOUT_MS,
        },
        (res) => {
          res.resume();
          const ok = res.statusCode === 200;
          resolve(
            ok ? { ok } : { ok, error: `Unexpected status ${res.statusCode}` },
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', (error) => resolve({ ok: false, error: error.message }));
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

  private async upsert(body: TraefikObject): Promise<void> {
    const plural =
      body.kind === 'Middleware' ? MIDDLEWARE_PLURAL : INGRESS_ROUTE_PLURAL;
    const target = {
      group: TRAEFIK_GROUP,
      version: TRAEFIK_VERSION,
      namespace: this.namespace,
      plural,
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
}
