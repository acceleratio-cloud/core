import type { V1Pod } from '@kubernetes/client-node';
import { countPods, stateOf } from '../system-status.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const pod = (ready: boolean, extra: Partial<V1Pod> = {}): V1Pod => ({
  status: {
    phase: 'Running',
    conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
  },
  ...extra,
});

describe('system status', () => {
  it('ignores finished and Job pods', () => {
    expect(
      countPods([
        pod(true),
        pod(false),
        pod(false, { status: { phase: 'Succeeded' } }),
        pod(false, {
          metadata: {
            ownerReferences: [
              { kind: 'Job', name: 'update', uid: '1', apiVersion: 'batch/v1' },
            ],
          },
        }),
      ]),
    ).toEqual({ ready: 1, total: 2 });
  });

  it('maps readiness to a state', () => {
    expect(stateOf(0, 0)).toBe('down');
    expect(stateOf(0, 2)).toBe('down');
    expect(stateOf(1, 2)).toBe('degraded');
    expect(stateOf(2, 2)).toBe('operational');
  });
});
