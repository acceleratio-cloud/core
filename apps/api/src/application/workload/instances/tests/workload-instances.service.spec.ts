import { BadRequestException } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { V1Pod } from '@kubernetes/client-node';
import type { WorkloadInstancesSnapshot } from '@acceleratio/shared';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  VictoriaMetricsUnavailableError,
  type PromSeries,
  type VictoriaMetricsClient,
} from '@/vendor/victoriametrics/victoriametrics.client';
import { WorkloadSnapshotStore } from '../../observer/workload-snapshot.store';
import type { WorkloadTypeResolver } from '../../workload-type.resolver';
import {
  INSTANCES_REFRESH_MS,
  POD_CHANGE_DEBOUNCE_MS,
  WorkloadInstancesService,
} from '../workload-instances.service';

// These pull the ESM-only Kubernetes client or the database; every instance
// here is faked.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('../../workload-type.resolver', () => ({
  WorkloadTypeResolver: class WorkloadTypeResolver {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const namespace = `project-${projectId}`;

const pod = (name: string, phase = 'Running'): V1Pod =>
  ({
    metadata: {
      name,
      uid: `uid-${name}`,
      labels: { 'acceleratio.io/workload-id': workloadId },
      creationTimestamp: new Date('2026-11-05T10:00:00Z'),
    },
    spec: { containers: [{ name: 'main', resources: {} }] },
    status: {
      phase,
      conditions: [{ type: 'Ready', status: 'True' }],
      containerStatuses: [{ name: 'main', restartCount: 0, state: {} }],
    },
  }) as unknown as V1Pod;

const series = (pod: string, value: string): PromSeries => ({
  metric: { pod },
  value: [0, value],
});

const createHarness = () => {
  const store = new WorkloadSnapshotStore();
  const resolver = { resolve: jest.fn().mockResolvedValue('docker') };
  const listNamespacedPod = jest.fn().mockResolvedValue({ items: [] });
  const query = jest.fn((promql: string) =>
    Promise.resolve(
      promql.includes('cpu')
        ? [series('web-a', '0.25')]
        : [series('web-a', '1048576')],
    ),
  );
  const service = new WorkloadInstancesService(
    resolver as unknown as WorkloadTypeResolver,
    store,
    { coreV1: { listNamespacedPod } } as unknown as KubernetesService,
    { query } as unknown as VictoriaMetricsClient,
  );

  return { service, store, resolver, listNamespacedPod, query };
};

describe('WorkloadInstancesService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects workloads that are not Docker services', async () => {
    const { service, resolver } = createHarness();

    resolver.resolve.mockResolvedValue('s3_bucket');

    await expect(service.get(projectId, workloadId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reads pods from the observer snapshot with their usage', async () => {
    const { service, store, listNamespacedPod } = createHarness();

    store.applyPod('add', pod('web-a'));

    const snapshot = await service.get(projectId, workloadId);

    expect(listNamespacedPod).not.toHaveBeenCalled();
    expect(snapshot.metrics_available).toBe(true);
    expect(snapshot.instances).toHaveLength(1);
    expect(snapshot.instances[0]).toMatchObject({
      name: 'web-a',
      status: 'running',
      cpu_cores: 0.25,
      memory_bytes: 1048576,
    });
  });

  it('lists pods from the cluster when the observer has none', async () => {
    const { service, listNamespacedPod } = createHarness();

    listNamespacedPod.mockResolvedValue({ items: [pod('web-a')] });

    const snapshot = await service.get(projectId, workloadId);

    expect(listNamespacedPod).toHaveBeenCalledWith({
      namespace,
      labelSelector: `acceleratio.io/workload-id=${workloadId}`,
    });
    expect(snapshot.instances.map(({ name }) => name)).toEqual(['web-a']);
  });

  it('has no instances when the namespace does not exist', async () => {
    const { service, listNamespacedPod, query } = createHarness();

    listNamespacedPod.mockRejectedValue({ code: 404 });

    const snapshot = await service.get(projectId, workloadId);

    expect(snapshot.instances).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('still lists instances when VictoriaMetrics is unreachable', async () => {
    const { service, store, query } = createHarness();

    store.applyPod('add', pod('web-a'));
    query.mockRejectedValue(new VictoriaMetricsUnavailableError('down'));

    const snapshot = await service.get(projectId, workloadId);

    expect(snapshot.metrics_available).toBe(false);
    expect(snapshot.instances[0]).toMatchObject({
      name: 'web-a',
      cpu_cores: null,
      memory_bytes: null,
    });
  });

  it('streams a frame on start, on pod changes and skips identical frames', async () => {
    jest.useFakeTimers();

    const { service, store } = createHarness();
    const frames: WorkloadInstancesSnapshot[] = [];

    store.applyPod('add', pod('web-a'));

    const subscription = service
      .stream(projectId, workloadId)
      .subscribe((event: MessageEvent) => {
        if (event.type !== 'heartbeat') {
          frames.push(event.data as WorkloadInstancesSnapshot);
        }
      });

    await jest.advanceTimersByTimeAsync(0);
    expect(frames).toHaveLength(1);

    // Nothing changed: the refresh tick produces an identical frame.
    await jest.advanceTimersByTimeAsync(INSTANCES_REFRESH_MS);
    expect(frames).toHaveLength(1);

    store.applyPod('add', pod('web-b'));
    await jest.advanceTimersByTimeAsync(POD_CHANGE_DEBOUNCE_MS);

    expect(frames).toHaveLength(2);
    expect(frames[1].instances.map(({ name }) => name).sort()).toEqual([
      'web-a',
      'web-b',
    ]);

    subscription.unsubscribe();
  });

  it('shares one refresh loop between viewers and replays the last frame', async () => {
    jest.useFakeTimers();

    const { service, store, query } = createHarness();
    const first: WorkloadInstancesSnapshot[] = [];
    const second: WorkloadInstancesSnapshot[] = [];
    const collect =
      (into: WorkloadInstancesSnapshot[]) => (event: MessageEvent) => {
        if (event.type !== 'heartbeat') {
          into.push(event.data as WorkloadInstancesSnapshot);
        }
      };

    store.applyPod('add', pod('web-a'));

    const a = service.stream(projectId, workloadId).subscribe(collect(first));

    await jest.advanceTimersByTimeAsync(0);

    const b = service.stream(projectId, workloadId).subscribe(collect(second));

    // The late viewer gets the current frame without a new query.
    expect(second).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(INSTANCES_REFRESH_MS);

    // One tick, one pair of usage queries, whatever the number of viewers.
    expect(query).toHaveBeenCalledTimes(4);

    a.unsubscribe();
    b.unsubscribe();

    // The last viewer leaving stops the loop; the next one starts afresh.
    await jest.advanceTimersByTimeAsync(INSTANCES_REFRESH_MS);
    expect(query).toHaveBeenCalledTimes(4);

    const c = service.stream(projectId, workloadId).subscribe(() => undefined);

    await jest.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(6);

    c.unsubscribe();
  });
});
