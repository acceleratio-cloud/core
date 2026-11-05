import { probeTarget } from '../traefik.client';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const hostname = 'api-203-0-113-10.sslip.io';

describe('probeTarget', () => {
  it('goes through the Traefik service inside the cluster', () => {
    expect(
      probeTarget(hostname, { KUBERNETES_SERVICE_HOST: '10.43.0.1' }),
    ).toBe('traefik.kube-system.svc.cluster.local');
  });

  it('goes to the hostname itself outside the cluster', () => {
    expect(probeTarget(hostname, {})).toBe(hostname);
  });

  it('prefers TRAEFIK_SERVICE_HOST', () => {
    expect(
      probeTarget(hostname, {
        TRAEFIK_SERVICE_HOST: '10.43.0.5',
        KUBERNETES_SERVICE_HOST: '10.43.0.1',
      }),
    ).toBe('10.43.0.5');
  });
});
