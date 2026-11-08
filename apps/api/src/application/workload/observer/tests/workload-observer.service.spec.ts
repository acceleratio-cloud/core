import { Logger } from '@nestjs/common';
import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import type { KubernetesWatchService } from '@/vendor/kubernetes/kubernetes-watch.service';
import type { WorkloadStatusService } from '../workload-status.service';
import { WORKLOAD_ID_LABEL } from '../../docker/docker-workload.manifests';
import {
  WorkloadSnapshotStore,
  type WorkloadSnapshot,
} from '../workload-snapshot.store';
import {
  DEPLOYMENT_SELECTOR,
  POD_SELECTOR,
  WorkloadObserverService,
} from '../workload-observer.service';

// The real watch service pulls in the ESM-only Kubernetes client and the
// status service pulls in the database. Both are injected collaborators here.
jest.mock('@/vendor/kubernetes/kubernetes-watch.service', () => ({
  KubernetesWatchService: class KubernetesWatchService {},
}));
jest.mock('../workload-status.service', () => ({
  WorkloadStatusService: class WorkloadStatusService {},
}));

const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const otherWorkloadId = '8e4b2c1d-3a5f-4b6e-9c7d-0e1f2a3b4c5d';
const ORIGINAL_ENV = { ...process.env };

type Handler = (value?: unknown) => void;

interface FakeInformer {
  on: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  emit: (event: string, value?: unknown) => void;
}

interface Harness {
  observer: WorkloadObserverService;
  watch: {
    createDeploymentInformer: jest.Mock;
    createPodInformer: jest.Mock;
    listDeployments: jest.Mock;
    listPods: jest.Mock;
  };
  writer: {
    announceChanges: jest.Mock;
    reconcileAll: jest.Mock;
  };
  snapshot: WorkloadSnapshotStore;
  deployments: FakeInformer[];
  pods: FakeInformer[];
}

const createFakeInformer = (): FakeInformer => {
  const handlers = new Map<string, Handler[]>();

  return {
    on: jest.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    emit: (event: string, value?: unknown) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(value);
      }
    },
  };
};

const createHarness = (): Harness => {
  const deployments: FakeInformer[] = [];
  const pods: FakeInformer[] = [];
  const watch = {
    createDeploymentInformer: jest.fn(() => {
      const informer = createFakeInformer();

      deployments.push(informer);

      return informer;
    }),
    createPodInformer: jest.fn(() => {
      const informer = createFakeInformer();

      pods.push(informer);

      return informer;
    }),
    listDeployments: jest.fn().mockResolvedValue([]),
    listPods: jest.fn().mockResolvedValue([]),
  };
  const writer = {
    announceChanges: jest.fn().mockResolvedValue(undefined),
    reconcileAll: jest.fn().mockResolvedValue(undefined),
  };
  const snapshot = new WorkloadSnapshotStore();
  const observer = new WorkloadObserverService(
    watch as unknown as KubernetesWatchService,
    snapshot,
    writer as unknown as WorkloadStatusService,
  );

  return { observer, watch, writer, snapshot, deployments, pods };
};

const deployment = (id: string): V1Deployment => ({
  metadata: {
    name: `deployment-${id}`,
    labels: { [WORKLOAD_ID_LABEL]: id },
  },
});

const pod = (id: string): V1Pod => ({
  metadata: {
    name: `pod-${id}`,
    uid: `pod-uid-${id}`,
    labels: { [WORKLOAD_ID_LABEL]: id },
  },
});

const flushPromises = async (): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
};

describe('WorkloadObserverService', () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    delete process.env.WORKLOAD_OBSERVER_ENABLED;
    delete process.env.WORKLOAD_OBSERVER_RESYNC_MS;
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();

    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }

    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('does nothing when the observer is disabled', async () => {
    process.env.WORKLOAD_OBSERVER_ENABLED = ' FALSE ';
    const { observer, watch, writer } = createHarness();

    observer.onApplicationBootstrap();
    await flushPromises();
    jest.advanceTimersByTime(120_000);

    expect(watch.createDeploymentInformer).not.toHaveBeenCalled();
    expect(watch.createPodInformer).not.toHaveBeenCalled();
    expect(watch.listDeployments).not.toHaveBeenCalled();
    expect(writer.reconcileAll).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not throw from bootstrap when the cluster is unavailable', async () => {
    const { observer, watch, writer, snapshot } = createHarness();
    const failure = new Error('cluster is unavailable');

    watch.listDeployments.mockRejectedValue(failure);
    watch.listPods.mockRejectedValue(failure);

    expect(() => observer.onApplicationBootstrap()).not.toThrow();
    await flushPromises();

    expect(watch.createDeploymentInformer).toHaveBeenCalledTimes(1);
    expect(watch.createPodInformer).toHaveBeenCalledTimes(1);
    expect(writer.reconcileAll).not.toHaveBeenCalled();
    expect(snapshot.ids()).toEqual([]);
    expect(errorLog).toHaveBeenCalled();
  });

  it('merges watch events into one debounced write', async () => {
    const { observer, writer, deployments } = createHarness();

    await observer.start();
    deployments[0].emit('add', deployment(workloadId));

    jest.advanceTimersByTime(200);

    deployments[0].emit('update', deployment(otherWorkloadId));

    jest.advanceTimersByTime(249);

    expect(writer.announceChanges).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);

    expect(writer.announceChanges).toHaveBeenCalledTimes(1);
    expect(writer.announceChanges).toHaveBeenCalledWith([
      workloadId,
      otherWorkloadId,
    ]);

    await observer.stop();
  });

  it('flushes a continuous event stream at the maximum wait', async () => {
    const { observer, deployments, writer } = createHarness();
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000005',
    ];

    await observer.start();
    deployments[0].emit('add', deployment(ids[0]));

    for (const id of ids.slice(1)) {
      jest.advanceTimersByTime(200);
      deployments[0].emit('update', deployment(id));
    }

    expect(writer.announceChanges).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);

    expect(writer.announceChanges).toHaveBeenCalledTimes(1);
    expect(writer.announceChanges).toHaveBeenCalledWith(ids);

    await observer.stop();
  });

  it('ignores objects without a workload id label', async () => {
    const { observer, deployments, pods, snapshot, writer } = createHarness();

    await observer.start();

    deployments[0].emit('add', { metadata: { name: 'unlabeled' } });
    pods[0].emit('add', { metadata: { name: 'unlabeled' } });
    jest.advanceTimersByTime(500);

    expect(snapshot.ids()).toEqual([]);
    expect(writer.announceChanges).not.toHaveBeenCalled();

    await observer.stop();
  });

  it('ignores objects whose workload id label is not a UUID', async () => {
    const { observer, deployments, pods, snapshot, writer } = createHarness();
    const invalidId = 'not-a-uuid';

    await observer.start();

    deployments[0].emit('add', deployment(invalidId));
    pods[0].emit('add', pod(invalidId));
    jest.advanceTimersByTime(1_000);

    expect(snapshot.ids()).toEqual([]);
    expect(snapshot.deploymentObservedAt(invalidId)).toBe(0);
    expect(writer.announceChanges).not.toHaveBeenCalled();

    await observer.stop();
  });

  it('grows the restart delay while starts keep failing', async () => {
    const { observer, watch } = createHarness();
    const created: FakeInformer[] = [];

    watch.createDeploymentInformer.mockImplementation(() => {
      const informer = createFakeInformer();

      informer.start.mockRejectedValue(new Error('cluster unreachable'));
      created.push(informer);

      return informer;
    });

    await observer.start();
    await flushPromises();

    expect(created).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(999);

    expect(created).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1);

    expect(created).toHaveLength(2);

    await jest.advanceTimersByTimeAsync(1_999);

    expect(created).toHaveLength(2);

    await jest.advanceTimersByTimeAsync(1);

    expect(created).toHaveLength(3);
    expect(created[2]).not.toBe(created[1]);
    expect(created[2].start).toHaveBeenCalledTimes(1);

    await observer.stop();
  });

  it('resets the backoff when an informer starts successfully', async () => {
    const failing = createFakeInformer();
    const { observer, watch, deployments } = createHarness();

    failing.start.mockRejectedValue(new Error('cluster unreachable'));
    watch.createDeploymentInformer.mockReturnValueOnce(failing);

    await observer.start();
    await flushPromises();

    // The failed start leaves the counter at 1, so the restart waits 1 s.
    await jest.advanceTimersByTimeAsync(1_000);

    const restarted = deployments[0];

    expect(watch.createDeploymentInformer).toHaveBeenCalledTimes(2);
    expect(restarted).not.toBe(failing);

    // This start succeeds, so the next failure must wait the base delay.
    restarted.emit('error', new Error('watch closed'));

    await jest.advanceTimersByTimeAsync(999);

    expect(watch.createDeploymentInformer).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1);

    expect(watch.createDeploymentInformer).toHaveBeenCalledTimes(3);

    await observer.stop();
  });

  it('does not reset the backoff when an informer fails during start', async () => {
    const { observer, watch } = createHarness();
    const created: FakeInformer[] = [];

    watch.createDeploymentInformer.mockImplementation(() => {
      const informer = createFakeInformer();

      informer.start.mockImplementation(() => {
        informer.emit('error', new Error('initial list failed'));

        return Promise.resolve();
      });
      created.push(informer);

      return informer;
    });

    await observer.start();
    await flushPromises();

    await jest.advanceTimersByTimeAsync(999);

    expect(created).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1);

    expect(created).toHaveLength(2);

    // The detached informer's resolved start did not reset the counter, so
    // the next attempt waits the doubled delay.
    await jest.advanceTimersByTimeAsync(1_999);

    expect(created).toHaveLength(2);

    await jest.advanceTimersByTimeAsync(1);

    expect(created).toHaveLength(3);

    await observer.stop();
  });

  it('does not reset the backoff when a relist replay precedes a failed watch', async () => {
    const { observer, watch } = createHarness();
    const created: FakeInformer[] = [];

    watch.createDeploymentInformer.mockImplementation(() => {
      const informer = createFakeInformer();

      // A reconnect replays the whole initial list as `add` events and then
      // reports the failed watch through `error`, the way ListWatch does.
      informer.start.mockImplementation(() => {
        informer.emit('add', deployment(workloadId));
        informer.emit('error', new Error('watch forbidden'));

        return Promise.resolve();
      });
      created.push(informer);

      return informer;
    });

    await observer.start();
    await flushPromises();

    expect(created).toHaveLength(1);

    // The replayed `add` must not reset the counter: the first restart waits
    // the base delay and the next one waits the doubled delay.
    await jest.advanceTimersByTimeAsync(999);

    expect(created).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1);

    expect(created).toHaveLength(2);

    await jest.advanceTimersByTimeAsync(1_999);

    expect(created).toHaveLength(2);

    await jest.advanceTimersByTimeAsync(1);

    expect(created).toHaveLength(3);

    await observer.stop();
  });

  it('restarts an informer whose start rejects', async () => {
    const failing = createFakeInformer();
    const { observer, watch, deployments } = createHarness();

    failing.start.mockRejectedValue(new Error('cannot list deployments'));
    watch.createDeploymentInformer.mockReturnValueOnce(failing);

    await observer.start();
    await flushPromises();

    expect(failing.start).toHaveBeenCalledTimes(1);
    expect(failing.stop).toHaveBeenCalledTimes(1);
    expect(watch.createDeploymentInformer).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);

    expect(watch.createDeploymentInformer).toHaveBeenCalledTimes(2);
    expect(deployments[0]).not.toBe(failing);
    expect(deployments[0].start).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalled();

    await observer.stop();
  });

  it('replaces the snapshot and reconciles on resync', async () => {
    const { observer, watch, writer, snapshot } = createHarness();

    watch.listDeployments.mockResolvedValue([deployment(workloadId)]);
    watch.listPods.mockResolvedValue([pod(workloadId)]);

    await observer.start();

    expect(watch.createDeploymentInformer).toHaveBeenCalledWith(
      DEPLOYMENT_SELECTOR,
    );
    expect(watch.createPodInformer).toHaveBeenCalledWith(POD_SELECTOR);
    expect(watch.listDeployments).toHaveBeenCalledWith(DEPLOYMENT_SELECTOR);
    expect(watch.listPods).toHaveBeenCalledWith(POD_SELECTOR);
    expect(snapshot.ids()).toEqual([workloadId]);
    expect(snapshot.get(workloadId)?.deployment).toBeDefined();
    expect(snapshot.get(workloadId)?.pods).toHaveLength(1);
    expect(writer.reconcileAll).toHaveBeenCalledTimes(1);

    watch.listDeployments.mockResolvedValue([]);
    watch.listPods.mockResolvedValue([]);

    await jest.advanceTimersByTimeAsync(60_000);

    expect(snapshot.ids()).toEqual([workloadId]);
    expect(snapshot.get(workloadId)?.deployment).toBeUndefined();
    expect(snapshot.get(workloadId)?.deploymentObserved).toBe(true);
    expect(snapshot.get(workloadId)?.pods).toEqual([]);
    expect(writer.reconcileAll).toHaveBeenCalledTimes(2);

    await observer.stop();
  });

  it('keeps a watch event applied while the resync list is in flight', async () => {
    const { observer, watch, writer, snapshot, deployments } = createHarness();
    const listedAt = Date.now();
    let resolveDeployments: (value: V1Deployment[]) => void = () => undefined;
    let seenByReconcile: WorkloadSnapshot | undefined;

    watch.listDeployments.mockImplementation(
      () =>
        new Promise<V1Deployment[]>((resolve) => {
          resolveDeployments = resolve;
        }),
    );
    writer.reconcileAll.mockImplementation(() => {
      seenByReconcile = snapshot.get(workloadId);

      return Promise.resolve();
    });

    const starting = observer.start();

    await flushPromises();

    // The list is still pending and reports the Deployment that a delete
    // event removed while the request was in flight.
    await jest.advanceTimersByTimeAsync(5);
    deployments[0].emit('delete', deployment(workloadId));
    resolveDeployments([deployment(workloadId)]);
    await starting;

    expect(snapshot.get(workloadId)?.deployment).toBeUndefined();
    expect(snapshot.get(workloadId)?.deploymentObserved).toBe(true);
    expect(snapshot.deploymentObservedAt(workloadId)).toBeGreaterThan(listedAt);
    expect(seenByReconcile?.deployment).toBeUndefined();
    expect(writer.reconcileAll).toHaveBeenCalledTimes(1);

    await observer.stop();
  });

  it('resyncs on the configured interval', async () => {
    process.env.WORKLOAD_OBSERVER_RESYNC_MS = '5000';
    const { observer, watch, writer } = createHarness();

    await observer.start();

    expect(watch.listDeployments).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(4_999);

    expect(watch.listDeployments).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);

    expect(watch.listDeployments).toHaveBeenCalledTimes(2);
    expect(writer.reconcileAll).toHaveBeenCalledTimes(2);

    await observer.stop();
  });

  it.each(['0', '-5', 'not-a-number'])(
    'falls back to the default interval for "%s"',
    async (value) => {
      process.env.WORKLOAD_OBSERVER_RESYNC_MS = value;
      const { observer, watch } = createHarness();

      await observer.start();
      await jest.advanceTimersByTimeAsync(59_999);

      expect(watch.listDeployments).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);

      expect(watch.listDeployments).toHaveBeenCalledTimes(2);

      await observer.stop();
    },
  );

  it('writes again when events arrive during a flush', async () => {
    const { observer, deployments, writer } = createHarness();
    let resolveWrite: () => void = () => undefined;

    await observer.start();
    writer.announceChanges.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    deployments[0].emit('add', deployment(workloadId));
    jest.advanceTimersByTime(250);

    expect(writer.announceChanges).toHaveBeenCalledTimes(1);

    deployments[0].emit('add', deployment(otherWorkloadId));
    resolveWrite();
    await flushPromises();

    jest.advanceTimersByTime(250);

    expect(writer.announceChanges).toHaveBeenCalledTimes(2);
    expect(writer.announceChanges).toHaveBeenLastCalledWith([otherWorkloadId]);

    await observer.stop();
  });

  it('logs a status update failure without crashing', async () => {
    const { observer, deployments, writer } = createHarness();

    await observer.start();
    writer.announceChanges.mockRejectedValueOnce(new Error('database is down'));

    deployments[0].emit('add', deployment(workloadId));
    jest.advanceTimersByTime(250);
    await flushPromises();

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('database is down'),
    );

    await observer.stop();
  });

  it('clears timers, stops informers and stops writing on shutdown', async () => {
    const { observer, watch, deployments, pods, writer } = createHarness();

    await observer.start();

    const deploymentInformer = deployments[0];
    const podInformer = pods[0];

    deploymentInformer.emit('add', deployment(workloadId));

    expect(jest.getTimerCount()).toBeGreaterThan(0);

    await observer.onApplicationShutdown();

    expect(deploymentInformer.stop).toHaveBeenCalledTimes(1);
    expect(podInformer.stop).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    deploymentInformer.emit('update', deployment(workloadId));
    podInformer.emit('add', pod(workloadId));
    await jest.advanceTimersByTimeAsync(60_000);

    expect(writer.announceChanges).not.toHaveBeenCalled();
    expect(watch.listDeployments).toHaveBeenCalledTimes(1);
    expect(writer.reconcileAll).toHaveBeenCalledTimes(1);
  });
});
