/**
 * Traefik objects that publish the control plane on its own host: `/api` goes
 * to the API with the prefix stripped, everything else to the console, and
 * plain HTTP redirects to HTTPS. Certificates come from the `letsencrypt`
 * resolver the installer configures on k3s's bundled Traefik.
 */
export const TRAEFIK_GROUP = 'traefik.io';
export const TRAEFIK_VERSION = 'v1alpha1';
export const MIDDLEWARE_PLURAL = 'middlewares';
export const INGRESS_ROUTE_PLURAL = 'ingressroutes';

export const CERT_RESOLVER = 'letsencrypt';
export const API_PATH = '/api';
/** Request header that tells the console to call the API at `/api`. */
export const API_PATH_HEADER = 'X-Acceleratio-Api-Path';

export const STRIP_API_MIDDLEWARE = 'control-plane-strip-api';
export const CONSOLE_HEADERS_MIDDLEWARE = 'control-plane-console-headers';
export const HTTPS_REDIRECT_MIDDLEWARE = 'control-plane-https-redirect';

/** Routes for the applied URL and for a URL that is being moved to. */
export const ACTIVE_ROUTE = 'control-plane';
export const PENDING_ROUTE = 'control-plane-pending';
export const httpRouteName = (name: string) => `${name}-http`;

export const API_SERVICE = { name: 'api', port: 8080 };
export const CONSOLE_SERVICE = { name: 'console', port: 3000 };

const LABELS = {
  'app.kubernetes.io/part-of': 'acceleratio',
  'app.kubernetes.io/managed-by': 'acceleratio-api',
};

export interface TraefikObject {
  apiVersion: string;
  kind: 'Middleware' | 'IngressRoute';
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    resourceVersion?: string;
  };
  spec: Record<string, unknown>;
}

const object = (
  kind: TraefikObject['kind'],
  name: string,
  namespace: string,
  spec: Record<string, unknown>,
): TraefikObject => ({
  apiVersion: `${TRAEFIK_GROUP}/${TRAEFIK_VERSION}`,
  kind,
  metadata: { name, namespace, labels: { ...LABELS } },
  spec,
});

export const buildMiddlewares = (namespace: string): TraefikObject[] => [
  object('Middleware', STRIP_API_MIDDLEWARE, namespace, {
    stripPrefix: { prefixes: [API_PATH] },
  }),
  object('Middleware', CONSOLE_HEADERS_MIDDLEWARE, namespace, {
    headers: { customRequestHeaders: { [API_PATH_HEADER]: API_PATH } },
  }),
  object('Middleware', HTTPS_REDIRECT_MIDDLEWARE, namespace, {
    redirectScheme: { scheme: 'https', permanent: true },
  }),
];

/** Backtick-quoted for Traefik rules; the hostname is already validated. */
const hostRule = (hostname: string) => `Host(\`${hostname}\`)`;

export const buildIngressRoutes = (
  name: string,
  namespace: string,
  hostname: string,
): TraefikObject[] => [
  object('IngressRoute', name, namespace, {
    entryPoints: ['websecure'],
    routes: [
      {
        match: `${hostRule(hostname)} && PathPrefix(\`${API_PATH}\`)`,
        kind: 'Rule',
        middlewares: [{ name: STRIP_API_MIDDLEWARE }],
        services: [API_SERVICE],
      },
      {
        match: hostRule(hostname),
        kind: 'Rule',
        middlewares: [{ name: CONSOLE_HEADERS_MIDDLEWARE }],
        services: [CONSOLE_SERVICE],
      },
    ],
    tls: { certResolver: CERT_RESOLVER },
  }),
  // ACME HTTP-01 challenges are answered by Traefik before user routers.
  object('IngressRoute', httpRouteName(name), namespace, {
    entryPoints: ['web'],
    routes: [
      {
        match: hostRule(hostname),
        kind: 'Rule',
        middlewares: [{ name: HTTPS_REDIRECT_MIDDLEWARE }],
        services: [CONSOLE_SERVICE],
      },
    ],
  }),
];
