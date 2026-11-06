import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { DockerWorkloadStatusDeriver } from '../docker-workload.deriver';
import { MOUNT_GRACE_MS, podsStuckMounting } from '../docker-workload.status';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const now = Date.parse('2026-11-06T12:00:00.000Z');

/** A Deployment whose rollout has not become available yet. */
const rollingDeployment: V1Deployment = {
  metadata: { name: 'web', generation: 2 },
  spec: { replicas: 1, selector: { matchLabels: {} }, template: {} },
  status: { observedGeneration: 2, updatedReplicas: 1, conditions: [] },
};

const pod = ({
  scheduledAgoMs = MOUNT_GRACE_MS + 1,
  claim = true,
  waiting = 'ContainerCreating',
  deleting = false,
}: {
  scheduledAgoMs?: number;
  claim?: boolean;
  waiting?: string | null;
  deleting?: boolean;
} = {}): V1Pod => ({
  metadata: {
    name: 'web-abc',
    namespace: 'project-1',
    ...(deleting ? { deletionTimestamp: new Date(now) } : {}),
  },
  spec: {
    containers: [{ name: 'main' }],
    volumes: claim
      ? [{ name: 'vol-1', persistentVolumeClaim: { claimName: 'web-vol-1' } }]
      : [],
  },
  status: {
    conditions: [
      {
        type: 'PodScheduled',
        status: 'True',
        lastTransitionTime: new Date(now - scheduledAgoMs),
      },
    ],
    containerStatuses:
      waiting === null
        ? [
            {
              name: 'main',
              image: 'nginx',
              imageID: '',
              ready: true,
              restartCount: 0,
              state: { running: {} },
            },
          ]
        : [
            {
              name: 'main',
              image: 'nginx',
              imageID: '',
              ready: false,
              restartCount: 0,
              state: { waiting: { reason: waiting } },
            },
          ],
  },
});

describe('podsStuckMounting', () => {
  it('finds a pod with a claim stuck creating past the grace period', () => {
    expect(podsStuckMounting([pod()], now)).toHaveLength(1);
  });

  it.each([
    ['within the grace period', pod({ scheduledAgoMs: 10_000 })],
    ['without a volume claim', pod({ claim: false })],
    ['already running', pod({ waiting: null })],
    ['failing for another reason', pod({ waiting: 'CrashLoopBackOff' })],
    ['being deleted', pod({ deleting: true })],
  ])('skips a pod %s', (_, candidate) => {
    expect(podsStuckMounting([candidate], now)).toEqual([]);
  });
});

describe('DockerWorkloadStatusDeriver', () => {
  const createDeriver = (events: unknown[] | Error) => {
    const listNamespacedEvent = jest.fn(() =>
      events instanceof Error
        ? Promise.reject(events)
        : Promise.resolve({ items: events }),
    );
    const kubernetes = {
      coreV1: { listNamespacedEvent },
    } as unknown as KubernetesService;

    return {
      deriver: new DockerWorkloadStatusDeriver(kubernetes),
      listNamespacedEvent,
    };
  };

  beforeEach(() => {
    jest.useFakeTimers({ now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fails a rollout whose volume cannot be mounted, with the latest reason', async () => {
    const { deriver, listNamespacedEvent } = createDeriver([
      {
        reason: 'FailedMount',
        message: 'old attempt',
        lastTimestamp: new Date(now - 50_000),
      },
      {
        reason: 'FailedMount',
        message: 'MountVolume.SetUp failed: connection refused',
        lastTimestamp: new Date(now - 5_000),
      },
      {
        reason: 'Scheduled',
        message: 'assigned',
        lastTimestamp: new Date(now),
      },
    ]);

    await expect(
      deriver.derive({ deployment: rollingDeployment, pods: [pod()] }),
    ).resolves.toEqual({
      status: 'failed',
      status_message:
        'FailedMount: MountVolume.SetUp failed: connection refused',
    });
    expect(listNamespacedEvent).toHaveBeenCalledWith({
      namespace: 'project-1',
      fieldSelector: 'involvedObject.kind=Pod,involvedObject.name=web-abc',
    });
  });

  it('keeps deploying when the events show no mount failure', async () => {
    const { deriver } = createDeriver([
      { reason: 'Pulling', message: 'pulling image' },
    ]);

    await expect(
      deriver.derive({ deployment: rollingDeployment, pods: [pod()] }),
    ).resolves.toEqual({ status: 'deploying', status_message: null });
  });

  it('keeps deploying when events cannot be read', async () => {
    const { deriver } = createDeriver(new Error('forbidden'));

    await expect(
      deriver.derive({ deployment: rollingDeployment, pods: [pod()] }),
    ).resolves.toEqual({ status: 'deploying', status_message: null });
  });

  it('reads no events while pods are within the grace period', async () => {
    const { deriver, listNamespacedEvent } = createDeriver([]);

    await deriver.derive({
      deployment: rollingDeployment,
      pods: [pod({ scheduledAgoMs: 1_000 })],
    });

    expect(listNamespacedEvent).not.toHaveBeenCalled();
  });
});
