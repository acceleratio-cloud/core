import {
  buildDomainRoutes,
  buildHttpsRedirectMiddleware,
  buildInternalService,
  buildNetworkService,
  domainHttpRouteName,
  domainRouteName,
  HTTPS_REDIRECT_MIDDLEWARE,
  servicePorts,
} from '../docker-workload-network.manifests';

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const namespace = `project-${projectId}`;
const workload = {
  id: '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8',
  project_id: projectId,
  external_name: 'my-api-3f9a1b2c',
};
const domain = {
  id: '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
  hostname: 'app.example.com',
  port: 8080,
};

describe('servicePorts', () => {
  it('returns each port once, in ascending order', () => {
    expect(
      servicePorts([
        { ...domain, port: 8080 },
        { ...domain, port: 80 },
        { ...domain, port: 8080 },
      ]),
    ).toEqual([80, 8080]);
  });
});

describe('buildNetworkService', () => {
  it('selects the pods by workload id and exposes one named port per port', () => {
    const service = buildNetworkService(workload, [80, 8080]);

    expect(service.metadata).toMatchObject({
      name: workload.external_name,
      namespace,
      labels: {
        'app.kubernetes.io/managed-by': 'acceleratio',
        'acceleratio.io/project-id': projectId,
        'acceleratio.io/workload-id': workload.id,
      },
    });
    expect(service.spec).toEqual({
      type: 'ClusterIP',
      selector: { 'acceleratio.io/workload-id': workload.id },
      ports: [
        { name: 'port-80', port: 80, targetPort: 80, protocol: 'TCP' },
        { name: 'port-8080', port: 8080, targetPort: 8080, protocol: 'TCP' },
      ],
    });
  });
});

describe('buildInternalService', () => {
  it('is a headless Service with no ports, so every port is reachable', () => {
    expect(buildInternalService(workload, 'postgres')).toEqual({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: 'postgres',
        namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'acceleratio',
          'acceleratio.io/project-id': projectId,
          'acceleratio.io/workload-id': workload.id,
          'acceleratio.io/service-role': 'internal',
        },
      },
      spec: {
        clusterIP: 'None',
        selector: { 'acceleratio.io/workload-id': workload.id },
      },
    });
  });
});

describe('buildHttpsRedirectMiddleware', () => {
  it('redirects to HTTPS in the project namespace', () => {
    const middleware = buildHttpsRedirectMiddleware(workload);

    expect(middleware).toMatchObject({
      apiVersion: 'traefik.io/v1alpha1',
      kind: 'Middleware',
      metadata: { name: HTTPS_REDIRECT_MIDDLEWARE, namespace },
      spec: { redirectScheme: { scheme: 'https', permanent: true } },
    });
  });
});

describe('buildDomainRoutes', () => {
  const [https, http] = buildDomainRoutes(workload, domain);

  it('routes HTTPS for the host to the service port with a Let’s Encrypt certificate', () => {
    expect(https).toMatchObject({
      kind: 'IngressRoute',
      metadata: {
        name: domainRouteName(domain.id),
        namespace,
        labels: { 'acceleratio.io/domain-id': domain.id },
      },
      spec: {
        entryPoints: ['websecure'],
        routes: [
          {
            match: 'Host(`app.example.com`)',
            kind: 'Rule',
            services: [{ name: workload.external_name, port: 8080 }],
          },
        ],
        tls: { certResolver: 'letsencrypt' },
      },
    });
  });

  it('redirects plain HTTP for the host', () => {
    expect(http).toMatchObject({
      metadata: { name: domainHttpRouteName(domain.id) },
      spec: {
        entryPoints: ['web'],
        routes: [
          {
            match: 'Host(`app.example.com`)',
            middlewares: [{ name: HTTPS_REDIRECT_MIDDLEWARE }],
          },
        ],
      },
    });
    expect(http.spec).not.toHaveProperty('tls');
  });

  it('names routes by domain id', () => {
    expect(domainRouteName(domain.id)).toBe(`domain-${domain.id}`);
    expect(domainHttpRouteName(domain.id)).toBe(`domain-${domain.id}-http`);
  });
});
