import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import {
  TraefikClient,
  type ProbeResult,
} from '@/vendor/traefik/traefik.client';
import {
  API_PATH,
  buildIngressRoutes,
  buildMiddlewares,
  httpRouteName,
} from './control-plane.manifests';

export {
  ACME_MISSING_MESSAGE,
  TRAEFIK_MISSING_MESSAGE,
  type ProbeResult,
} from '@/vendor/traefik/traefik.client';

const SERVICE_ACCOUNT_NAMESPACE_FILE =
  '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
const DEFAULT_NAMESPACE = 'acceleratio';

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
  readonly namespace = readNamespace();

  constructor(private readonly traefik: TraefikClient) {}

  /** Throws 409 when the cluster cannot serve a custom URL with HTTPS. */
  assertAvailable(): Promise<void> {
    return this.traefik.assertAvailable();
  }

  /** Creates or updates the middlewares and the routes `name` for `hostname`. */
  async publish(name: string, hostname: string): Promise<void> {
    const objects = [
      ...buildMiddlewares(this.namespace),
      ...buildIngressRoutes(name, this.namespace, hostname),
    ];
    for (const body of objects) {
      await this.traefik.upsert(body);
    }
  }

  /** Deletes the routes `name`; missing objects are ignored. */
  async unpublish(name: string): Promise<void> {
    for (const routeName of [name, httpRouteName(name)]) {
      await this.traefik.delete('IngressRoute', this.namespace, routeName);
    }
  }

  /** Succeeds once `https://<hostname>/api/healthz` answers 200. */
  probe(hostname: string): Promise<ProbeResult> {
    return this.traefik.probe(hostname, {
      path: `${API_PATH}/healthz`,
      expectStatus: 200,
    });
  }
}
