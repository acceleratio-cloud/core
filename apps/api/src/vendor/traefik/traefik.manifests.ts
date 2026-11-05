/**
 * Traefik custom resources served by k3s's bundled Traefik. Certificates come
 * from the `letsencrypt` resolver the installer configures on it.
 */
export const TRAEFIK_GROUP = 'traefik.io';
export const TRAEFIK_VERSION = 'v1alpha1';
export const MIDDLEWARE_PLURAL = 'middlewares';
export const INGRESS_ROUTE_PLURAL = 'ingressroutes';
export const CERT_RESOLVER = 'letsencrypt';

export type TraefikKind = 'Middleware' | 'IngressRoute';

export interface TraefikObject {
  apiVersion: string;
  kind: TraefikKind;
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    resourceVersion?: string;
  };
  spec: Record<string, unknown>;
}

export const traefikPlural = (kind: TraefikKind): string =>
  kind === 'Middleware' ? MIDDLEWARE_PLURAL : INGRESS_ROUTE_PLURAL;

export const traefikObject = (
  kind: TraefikKind,
  name: string,
  namespace: string,
  labels: Record<string, string>,
  spec: Record<string, unknown>,
): TraefikObject => ({
  apiVersion: `${TRAEFIK_GROUP}/${TRAEFIK_VERSION}`,
  kind,
  metadata: { name, namespace, labels: { ...labels } },
  spec,
});

/** Backtick-quoted for Traefik rules; the hostname must already be validated. */
export const hostRule = (hostname: string) => `Host(\`${hostname}\`)`;
