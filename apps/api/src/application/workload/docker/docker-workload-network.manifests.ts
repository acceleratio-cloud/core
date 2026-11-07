import type { V1Service } from '@kubernetes/client-node';
import { projectNamespace } from '@/common/naming';
import {
  CERT_RESOLVER,
  hostRule,
  traefikObject,
  type TraefikObject,
} from '@/vendor/traefik/traefik.manifests';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  PROJECT_ID_LABEL,
  WORKLOAD_ID_LABEL,
} from './docker-workload.manifests';

export const DOMAIN_ID_LABEL = 'acceleratio.io/domain-id';
/** Tells the private-network Service apart from the domain Service. */
export const SERVICE_ROLE_LABEL = 'acceleratio.io/service-role';
export const INTERNAL_SERVICE_ROLE = 'internal';
/** Shared by every domain in a project namespace. */
export const HTTPS_REDIRECT_MIDDLEWARE = 'acceleratio-https-redirect';

/** What the network manifests need to know about a service. */
export interface NetworkWorkloadInput {
  id: string;
  project_id: string;
  external_name: string;
}

export interface NetworkDomainInput {
  id: string;
  hostname: string;
  port: number;
}

export const servicePortName = (port: number): string => `port-${port}`;

/** Named by the domain id, so a hostname or port change keeps the name. */
export const domainRouteName = (domainId: string): string =>
  `domain-${domainId}`;
export const domainHttpRouteName = (domainId: string): string =>
  `${domainRouteName(domainId)}-http`;

const labels = (workload: NetworkWorkloadInput): Record<string, string> => ({
  [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  [PROJECT_ID_LABEL]: workload.project_id,
  [WORKLOAD_ID_LABEL]: workload.id,
});

/** Distinct ports in ascending order. */
export const servicePorts = (domains: NetworkDomainInput[]): number[] =>
  [...new Set(domains.map(({ port }) => port))].sort((a, b) => a - b);

/**
 * ClusterIP Service in front of the service's pods with one port per distinct
 * domain port. It reaches the pods by the workload label, so it needs nothing
 * from the pod template and creating or changing it never rolls pods.
 */
export const buildNetworkService = (
  workload: NetworkWorkloadInput,
  ports: number[],
  resourceVersion?: string,
): V1Service => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: {
    name: workload.external_name,
    namespace: projectNamespace(workload.project_id),
    labels: labels(workload),
    ...(resourceVersion !== undefined ? { resourceVersion } : {}),
  },
  spec: {
    type: 'ClusterIP',
    selector: { [WORKLOAD_ID_LABEL]: workload.id },
    ports: ports.map((port) => ({
      name: servicePortName(port),
      port,
      targetPort: port,
      protocol: 'TCP',
    })),
  },
});

/**
 * Headless Service named by the service's private hostname. With no cluster
 * IP, DNS answers with the ready pod IPs themselves, so every port the
 * container listens on is reachable and no port has to be declared. Only
 * pods of the same project can connect: the isolation policy allows the
 * project namespace and nothing else inside the cluster.
 */
export const buildInternalService = (
  workload: NetworkWorkloadInput,
  hostname: string,
): V1Service => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: {
    name: hostname,
    namespace: projectNamespace(workload.project_id),
    labels: {
      ...labels(workload),
      [SERVICE_ROLE_LABEL]: INTERNAL_SERVICE_ROLE,
    },
  },
  spec: {
    clusterIP: 'None',
    selector: { [WORKLOAD_ID_LABEL]: workload.id },
  },
});

export const buildHttpsRedirectMiddleware = (
  workload: NetworkWorkloadInput,
): TraefikObject =>
  traefikObject(
    'Middleware',
    HTTPS_REDIRECT_MIDDLEWARE,
    projectNamespace(workload.project_id),
    {
      [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      [PROJECT_ID_LABEL]: workload.project_id,
    },
    { redirectScheme: { scheme: 'https', permanent: true } },
  );

/**
 * HTTPS route to the Service port with a Let's Encrypt certificate, and a
 * plain HTTP route that redirects to it. Traefik answers ACME HTTP-01
 * challenges before user routers, so the redirect does not block issuance.
 */
export const buildDomainRoutes = (
  workload: NetworkWorkloadInput,
  domain: NetworkDomainInput,
): TraefikObject[] => {
  const namespace = projectNamespace(workload.project_id);
  const routeLabels = { ...labels(workload), [DOMAIN_ID_LABEL]: domain.id };
  const service = { name: workload.external_name, port: domain.port };

  return [
    traefikObject(
      'IngressRoute',
      domainRouteName(domain.id),
      namespace,
      routeLabels,
      {
        entryPoints: ['websecure'],
        routes: [
          {
            match: hostRule(domain.hostname),
            kind: 'Rule',
            services: [service],
          },
        ],
        tls: { certResolver: CERT_RESOLVER },
      },
    ),
    traefikObject(
      'IngressRoute',
      domainHttpRouteName(domain.id),
      namespace,
      routeLabels,
      {
        entryPoints: ['web'],
        routes: [
          {
            match: hostRule(domain.hostname),
            kind: 'Rule',
            middlewares: [{ name: HTTPS_REDIRECT_MIDDLEWARE }],
            services: [service],
          },
        ],
      },
    ),
  ];
};
