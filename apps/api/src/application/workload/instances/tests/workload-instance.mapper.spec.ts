import type { V1Pod } from '@kubernetes/client-node';
import type { WorkloadInstance } from '@acceleratio/shared';
import {
  compareInstances,
  deriveInstanceStatus,
  toInstance,
} from '../workload-instance.mapper';

const versionId = '0b8e7a6c-5d4f-4e3a-9b2c-1d0e9f8a7b6c';

const pod = (overrides: {
  phase?: string;
  ready?: boolean;
  scheduled?: { status: string; reason?: string; message?: string };
  waiting?: { reason: string; message?: string };
  terminated?: { reason: string; message?: string };
  deleting?: boolean;
  restarts?: number[];
  limits?: { cpu?: string; memory?: string }[];
}): V1Pod =>
  ({
    metadata: {
      name: 'web-6d8f9c7b5-x2k4p',
      creationTimestamp: new Date('2026-11-05T10:00:00Z'),
      annotations: { 'acceleratio.io/workload-version-id': versionId },
      ...(overrides.deleting
        ? { deletionTimestamp: new Date('2026-11-05T10:05:00Z') }
        : {}),
    },
    spec: {
      nodeName: 'node-1',
      containers: (overrides.limits ?? [{ cpu: '500m', memory: '256Mi' }]).map(
        (limits, index) => ({ name: `c${index}`, resources: { limits } }),
      ),
    },
    status: {
      phase: overrides.phase ?? 'Running',
      podIP: '10.0.0.7',
      startTime: new Date('2026-11-05T10:00:02Z'),
      conditions: [
        ...(overrides.scheduled
          ? [{ type: 'PodScheduled', ...overrides.scheduled }]
          : [{ type: 'PodScheduled', status: 'True' }]),
        { type: 'Ready', status: overrides.ready === false ? 'False' : 'True' },
      ],
      containerStatuses: (overrides.restarts ?? [0]).map(
        (restartCount, index) => ({
          name: `c${index}`,
          restartCount,
          state: overrides.waiting
            ? { waiting: overrides.waiting }
            : overrides.terminated
              ? { terminated: overrides.terminated }
              : { running: {} },
        }),
      ),
    },
  }) as unknown as V1Pod;

describe('deriveInstanceStatus', () => {
  it('is running when the pod runs and is ready', () => {
    expect(deriveInstanceStatus(pod({}))).toEqual({
      status: 'running',
      status_reason: null,
      status_message: null,
    });
  });

  it('is terminating once deletion started, even when failing', () => {
    expect(
      deriveInstanceStatus(
        pod({ deleting: true, waiting: { reason: 'CrashLoopBackOff' } }),
      ).status,
    ).toBe('terminating');
  });

  it('is failed with the reason of a failing container', () => {
    expect(
      deriveInstanceStatus(
        pod({
          phase: 'Pending',
          waiting: { reason: 'ImagePullBackOff', message: ' pull failed ' },
        }),
      ),
    ).toEqual({
      status: 'failed',
      status_reason: 'ImagePullBackOff',
      status_message: 'pull failed',
    });
  });

  it('is failed when the container was OOM killed', () => {
    expect(
      deriveInstanceStatus(pod({ terminated: { reason: 'OOMKilled' } })),
    ).toMatchObject({ status: 'failed', status_reason: 'OOMKilled' });
  });

  it('is pending when the pod cannot be scheduled', () => {
    expect(
      deriveInstanceStatus(
        pod({
          phase: 'Pending',
          scheduled: {
            status: 'False',
            reason: 'Unschedulable',
            message: 'Insufficient cpu',
          },
        }),
      ),
    ).toEqual({
      status: 'pending',
      status_reason: 'Unschedulable',
      status_message: 'Insufficient cpu',
    });
  });

  it('is starting while the container is being created', () => {
    expect(
      deriveInstanceStatus(
        pod({ phase: 'Pending', waiting: { reason: 'ContainerCreating' } }),
      ),
    ).toMatchObject({ status: 'starting', status_reason: 'ContainerCreating' });
  });

  it('is starting while running but not ready yet', () => {
    expect(deriveInstanceStatus(pod({ ready: false })).status).toBe('starting');
  });

  it('maps finished phases', () => {
    expect(deriveInstanceStatus(pod({ phase: 'Succeeded' })).status).toBe(
      'completed',
    );
    expect(deriveInstanceStatus(pod({ phase: 'Failed' })).status).toBe(
      'failed',
    );
    expect(deriveInstanceStatus(pod({ phase: 'Unknown' })).status).toBe(
      'unknown',
    );
  });
});

describe('toInstance', () => {
  it('maps the pod with its usage and limits', () => {
    expect(
      toInstance(pod({ restarts: [2, 1] }), {
        cpu_cores: 0.12,
        memory_bytes: 64 * 1024 ** 2,
      }),
    ).toEqual({
      name: 'web-6d8f9c7b5-x2k4p',
      status: 'running',
      status_reason: null,
      status_message: null,
      ready: true,
      restarts: 3,
      node: 'node-1',
      ip: '10.0.0.7',
      version_id: versionId,
      created_at: '2026-11-05T10:00:00.000Z',
      started_at: '2026-11-05T10:00:02.000Z',
      cpu_cores: 0.12,
      cpu_limit_cores: 0.5,
      memory_bytes: 64 * 1024 ** 2,
      memory_limit_bytes: 256 * 1024 ** 2,
    });
  });

  it('has no limit once any container runs without one', () => {
    const instance = toInstance(
      pod({ limits: [{ cpu: '1', memory: '1Gi' }, { memory: '128Mi' }] }),
    );

    expect(instance.cpu_limit_cores).toBeNull();
    expect(instance.memory_limit_bytes).toBe(1024 ** 3 + 128 * 1024 ** 2);
  });

  it('leaves usage unknown without samples', () => {
    const instance = toInstance(pod({}));

    expect(instance.cpu_cores).toBeNull();
    expect(instance.memory_bytes).toBeNull();
  });
});

describe('compareInstances', () => {
  const instance = (
    name: string,
    created_at: string,
    status: WorkloadInstance['status'] = 'running',
  ) => ({ name, created_at, status }) as WorkloadInstance;

  it('puts the newest first and terminating instances last', () => {
    const sorted = [
      instance('old', '2026-11-05T09:00:00.000Z'),
      instance('leaving', '2026-11-05T11:00:00.000Z', 'terminating'),
      instance('new', '2026-11-05T10:00:00.000Z'),
    ].sort(compareInstances);

    expect(sorted.map(({ name }) => name)).toEqual(['new', 'old', 'leaving']);
  });
});
