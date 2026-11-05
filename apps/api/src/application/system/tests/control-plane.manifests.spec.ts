import {
  buildIngressRoutes,
  buildMiddlewares,
  CERT_RESOLVER,
  STRIP_API_MIDDLEWARE,
} from '../control-plane.manifests';

describe('control plane manifests', () => {
  it('routes /api to the API and the rest to the console over HTTPS', () => {
    const [secure, http] = buildIngressRoutes(
      'control-plane',
      'acceleratio',
      'cloud.example.com',
    );

    expect(secure.metadata).toMatchObject({
      name: 'control-plane',
      namespace: 'acceleratio',
    });
    expect(secure.spec).toEqual({
      entryPoints: ['websecure'],
      routes: [
        {
          match: 'Host(`cloud.example.com`) && PathPrefix(`/api`)',
          kind: 'Rule',
          middlewares: [{ name: STRIP_API_MIDDLEWARE }],
          services: [{ name: 'api', port: 8080 }],
        },
        {
          match: 'Host(`cloud.example.com`)',
          kind: 'Rule',
          middlewares: [{ name: 'control-plane-console-headers' }],
          services: [{ name: 'console', port: 3000 }],
        },
      ],
      tls: { certResolver: CERT_RESOLVER },
    });

    expect(http.metadata.name).toBe('control-plane-http');
    expect(http.spec).toMatchObject({
      entryPoints: ['web'],
      routes: [
        {
          match: 'Host(`cloud.example.com`)',
          middlewares: [{ name: 'control-plane-https-redirect' }],
        },
      ],
    });
  });

  it('defines the strip, header and redirect middlewares', () => {
    const middlewares = buildMiddlewares('acceleratio');
    expect(middlewares.map((m) => [m.metadata.name, m.spec])).toEqual([
      ['control-plane-strip-api', { stripPrefix: { prefixes: ['/api'] } }],
      [
        'control-plane-console-headers',
        {
          headers: {
            customRequestHeaders: { 'X-Acceleratio-Api-Path': '/api' },
          },
        },
      ],
      [
        'control-plane-https-redirect',
        { redirectScheme: { scheme: 'https', permanent: true } },
      ],
    ]);
  });
});
