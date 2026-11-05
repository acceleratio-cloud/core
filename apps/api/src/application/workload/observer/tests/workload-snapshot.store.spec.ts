import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import { WORKLOAD_ID_LABEL } from '../../docker/docker-workload.manifests';
import { WorkloadSnapshotStore } from '../workload-snapshot.store';

const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const otherWorkloadId = '7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f';

const labels = (id: string): Record<string, string> => ({
  [WORKLOAD_ID_LABEL]: id,
});

const createDeployment = (
  id: string | undefined,
  name = 'my-api',
): V1Deployment => ({
  metadata: {
    name,
    ...(id === undefined ? {} : { labels: labels(id) }),
  },
  spec: { replicas: 1, selector: { matchLabels: {} }, template: {} },
});

const createPod = (
  id: string | undefined,
  uid: string | undefined,
  name = 'my-api-abc',
): V1Pod => ({
  metadata: {
    name,
    uid,
    ...(id === undefined ? {} : { labels: labels(id) }),
  },
  status: { phase: 'Running' },
});

const NOW = new Date('2026-11-02T10:00:00.000Z');

describe('WorkloadSnapshotStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores a Deployment under its workload id', () => {
    const store = new WorkloadSnapshotStore();
    const deployment = createDeployment(workloadId);

    store.applyDeployment('add', deployment);

    expect(store.ids()).toEqual([workloadId]);
    expect(store.get(workloadId)).toEqual({
      deployment,
      deploymentObserved: true,
      pods: [],
    });
    expect(store.deploymentObservedAt(workloadId)).toBe(NOW.getTime());
  });

  it('replaces the Deployment on update and keeps its pods', () => {
    const store = new WorkloadSnapshotStore();
    const pod = createPod(workloadId, 'uid-1');

    store.applyDeployment('add', createDeployment(workloadId, 'old-name'));
    store.applyPod('add', pod);
    store.applyDeployment('update', createDeployment(workloadId, 'new-name'));

    const snapshot = store.get(workloadId);

    expect(snapshot?.deployment?.metadata?.name).toBe('new-name');
    expect(snapshot?.pods).toEqual([pod]);
  });

  it('keeps a deleted Deployment id with a fresh observation time', () => {
    const store = new WorkloadSnapshotStore();

    store.applyDeployment('add', createDeployment(workloadId));
    jest.setSystemTime(new Date('2026-11-02T10:00:05.000Z'));
    store.applyDeployment('delete', createDeployment(workloadId));

    const snapshot = store.get(workloadId);

    expect(store.ids()).toEqual([workloadId]);
    expect(snapshot?.deployment).toBeUndefined();
    expect(snapshot?.deploymentObserved).toBe(true);
    expect(snapshot?.pods).toEqual([]);
    expect(store.deploymentObservedAt(workloadId)).toBe(
      new Date('2026-11-02T10:00:05.000Z').getTime(),
    );
  });

  it('records a delete for an unknown workload as drift', () => {
    const store = new WorkloadSnapshotStore();

    store.applyDeployment('delete', createDeployment(workloadId));

    expect(store.ids()).toEqual([workloadId]);
    expect(store.get(workloadId)?.deployment).toBeUndefined();
    expect(store.get(workloadId)?.deploymentObserved).toBe(true);
    expect(store.deploymentObservedAt(workloadId)).toBe(NOW.getTime());
  });

  it('ignores Deployments without the workload label', () => {
    const store = new WorkloadSnapshotStore();

    store.applyDeployment('add', createDeployment(undefined));
    store.applyDeployment('add', { metadata: {} });

    expect(store.ids()).toEqual([]);
    expect(store.get(workloadId)).toBeUndefined();
    expect(store.deploymentObservedAt(workloadId)).toBe(0);
  });

  it('groups pods under the workload label', () => {
    const store = new WorkloadSnapshotStore();
    const first = createPod(workloadId, 'uid-1');
    const second = createPod(workloadId, 'uid-2', 'my-api-def');

    store.applyPod('add', first);
    store.applyPod('add', second);

    expect(store.get(workloadId)?.pods).toEqual([first, second]);
    expect(store.get(workloadId)?.deployment).toBeUndefined();
    expect(store.get(workloadId)?.deploymentObserved).toBe(false);
  });

  it('updates a pod in place by uid', () => {
    const store = new WorkloadSnapshotStore();
    const original = createPod(workloadId, 'uid-1');
    const updated: V1Pod = {
      ...createPod(workloadId, 'uid-1'),
      status: { phase: 'Succeeded' },
    };

    store.applyPod('add', original);
    store.applyPod('update', updated);

    expect(store.get(workloadId)?.pods).toEqual([updated]);
  });

  it('falls back to the pod name when the uid is missing', () => {
    const store = new WorkloadSnapshotStore();
    const original = createPod(workloadId, undefined, 'my-api-abc');
    const updated: V1Pod = {
      ...createPod(workloadId, undefined, 'my-api-abc'),
      status: { phase: 'Succeeded' },
    };

    store.applyPod('add', original);
    store.applyPod('update', updated);

    expect(store.get(workloadId)?.pods).toEqual([updated]);
  });

  it('removes a deleted pod by uid', () => {
    const store = new WorkloadSnapshotStore();
    const first = createPod(workloadId, 'uid-1');
    const second = createPod(workloadId, 'uid-2', 'my-api-def');

    store.applyPod('add', first);
    store.applyPod('add', second);
    store.applyPod('delete', first);

    expect(store.get(workloadId)?.pods).toEqual([second]);
  });

  it('keeps the workload id when its last pod is deleted', () => {
    const store = new WorkloadSnapshotStore();

    store.applyPod('add', createPod(workloadId, 'uid-1'));
    jest.setSystemTime(new Date('2026-11-02T10:00:05.000Z'));
    store.applyPod('delete', createPod(workloadId, 'uid-1'));

    expect(store.ids()).toEqual([workloadId]);
    expect(store.get(workloadId)?.pods).toEqual([]);
    expect(store.get(workloadId)?.deploymentObserved).toBe(false);
    // A Pod event only moves the Pod clock; the Deployment clock must stay
    // at 0 so the writer's mutation fence still holds.
    expect(store.deploymentObservedAt(workloadId)).toBe(0);
  });

  it('creates an unobserved entry from a Pod delete', () => {
    const store = new WorkloadSnapshotStore();

    store.applyPod('delete', createPod(workloadId, 'uid-1'));

    expect(store.ids()).toEqual([workloadId]);
    expect(store.get(workloadId)?.pods).toEqual([]);
    expect(store.get(workloadId)?.deploymentObserved).toBe(false);
  });

  it('marks the Deployment observed once a Deployment event arrives', () => {
    const store = new WorkloadSnapshotStore();
    const deployment = createDeployment(workloadId);

    store.applyPod('add', createPod(workloadId, 'uid-1'));
    expect(store.get(workloadId)?.deploymentObserved).toBe(false);

    store.applyDeployment('add', deployment);

    expect(store.get(workloadId)?.deploymentObserved).toBe(true);
    expect(store.get(workloadId)?.deployment).toEqual(deployment);
  });

  it('ignores pods without the workload label', () => {
    const store = new WorkloadSnapshotStore();

    store.applyPod('add', createPod(undefined, 'uid-1'));
    store.applyPod('add', { metadata: {} });

    expect(store.ids()).toEqual([]);
    expect(store.get(workloadId)).toBeUndefined();
  });

  it('ignores labels that are not canonical UUIDs', () => {
    const store = new WorkloadSnapshotStore();
    const invalidIds = [
      'workload-1',
      '3f9a1b2c4d5e6f708192a3b4c5d6e7f8',
      `${workloadId}0`,
      ` ${workloadId}`,
    ];

    for (const id of invalidIds) {
      store.applyDeployment('add', createDeployment(id));
      store.applyDeployment('delete', createDeployment(id));
      store.applyPod('add', createPod(id, 'uid-1'));
      store.applyPod('delete', createPod(id, 'uid-2'));
      store.replaceAll(
        [createDeployment(id)],
        [createPod(id, 'uid-3')],
        NOW.getTime(),
      );

      expect(store.ids()).toEqual([]);
    }

    expect(store.deploymentObservedAt(workloadId)).toBe(0);
  });

  it('replaces the listed workloads without dropping other ids', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = new Date('2026-11-02T10:00:30.000Z').getTime();

    store.applyDeployment('add', createDeployment(workloadId));
    jest.setSystemTime(new Date(listedAt));

    const deployment = createDeployment(otherWorkloadId);
    const pod = createPod(otherWorkloadId, 'uid-1');

    store.replaceAll([deployment], [pod], listedAt);

    expect(store.ids()).toEqual([workloadId, otherWorkloadId]);
    expect(store.get(workloadId)).toEqual({
      deployment: undefined,
      deploymentObserved: true,
      pods: [],
    });
    expect(store.deploymentObservedAt(workloadId)).toBe(listedAt);
    expect(store.get(otherWorkloadId)).toEqual({
      deployment,
      deploymentObserved: true,
      pods: [pod],
    });
    expect(store.deploymentObservedAt(otherWorkloadId)).toBe(listedAt);
  });

  it('stamps list entries with the supplied listedAt', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime() - 2_000;
    const deployment = createDeployment(workloadId);
    const pod = createPod(workloadId, 'uid-1');

    store.replaceAll([deployment], [pod], listedAt);

    expect(store.get(workloadId)?.deployment).toEqual(deployment);
    expect(store.get(workloadId)?.pods).toEqual([pod]);
    expect(store.deploymentObservedAt(workloadId)).toBe(listedAt);
  });

  it('stamps every workload from the new snapshot on replaceAll', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime();
    const onlyPod = createPod(otherWorkloadId, 'uid-1');

    store.replaceAll(
      [createDeployment(workloadId)],
      [onlyPod, createPod(undefined, 'uid-2')],
      listedAt,
    );

    expect(store.ids()).toEqual([workloadId, otherWorkloadId]);
    expect(store.deploymentObservedAt(workloadId)).toBe(listedAt);
    expect(store.deploymentObservedAt(otherWorkloadId)).toBe(listedAt);
    expect(store.get(workloadId)?.deploymentObserved).toBe(true);
    expect(store.get(otherWorkloadId)?.deploymentObserved).toBe(true);
    expect(store.get(otherWorkloadId)?.pods).toEqual([onlyPod]);
  });

  it('keeps a Deployment delete that happened after the list started', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime();
    const staleDeployment = createDeployment(workloadId);
    const deletedAt = listedAt + 500;

    jest.setSystemTime(new Date(deletedAt));
    store.applyDeployment('delete', staleDeployment);
    store.replaceAll([staleDeployment], [], listedAt);

    expect(store.get(workloadId)?.deployment).toBeUndefined();
    expect(store.get(workloadId)?.deploymentObserved).toBe(true);
    expect(store.deploymentObservedAt(workloadId)).toBe(deletedAt);
  });

  it('keeps a Deployment update that happened after the list started', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime();
    const updatedAt = listedAt + 500;
    const updated = createDeployment(workloadId, 'new-name');

    jest.setSystemTime(new Date(updatedAt));
    store.applyDeployment('update', updated);
    store.replaceAll([createDeployment(workloadId, 'old-name')], [], listedAt);

    expect(store.get(workloadId)?.deployment?.metadata?.name).toBe('new-name');
    expect(store.get(workloadId)?.deploymentObserved).toBe(true);
    expect(store.deploymentObservedAt(workloadId)).toBe(updatedAt);
  });

  it('takes the listed Deployment when only the Pods moved on', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime();
    const podAddedAt = listedAt + 500;
    const listedDeployment = createDeployment(workloadId, 'listed-name');
    const pod = createPod(workloadId, 'uid-1');

    jest.setSystemTime(new Date(podAddedAt));
    store.applyPod('add', pod);
    store.replaceAll([listedDeployment], [], listedAt);

    expect(store.get(workloadId)?.deployment).toEqual(listedDeployment);
    expect(store.get(workloadId)?.deploymentObserved).toBe(true);
    expect(store.get(workloadId)?.pods).toEqual([pod]);
    // The Pod event is newer, but the Deployment clock stays at the list
    // stamp: only a Deployment observation may release the mutation fence.
    expect(store.deploymentObservedAt(workloadId)).toBe(listedAt);
  });

  it('takes the listed Pods when only the Deployment moved on', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime();
    const updatedAt = listedAt + 500;
    const listedPod = createPod(workloadId, 'uid-listed');

    jest.setSystemTime(new Date(updatedAt));
    store.applyDeployment('update', createDeployment(workloadId, 'new-name'));
    store.replaceAll(
      [createDeployment(workloadId, 'old-name')],
      [listedPod],
      listedAt,
    );

    expect(store.get(workloadId)?.deployment?.metadata?.name).toBe('new-name');
    expect(store.get(workloadId)?.pods).toEqual([listedPod]);
    expect(store.deploymentObservedAt(workloadId)).toBe(updatedAt);
  });

  it('tombstones a Deployment deleted between resyncs', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime() + 1_000;

    store.applyDeployment('add', createDeployment(workloadId));
    store.applyPod('add', createPod(workloadId, 'uid-1'));
    store.replaceAll([], [], listedAt);

    expect(store.ids()).toEqual([workloadId]);
    expect(store.get(workloadId)?.deployment).toBeUndefined();
    expect(store.get(workloadId)?.deploymentObserved).toBe(true);
    expect(store.get(workloadId)?.pods).toEqual([]);
    expect(store.deploymentObservedAt(workloadId)).toBe(listedAt);
  });

  it('drops Pods the list excludes even when another Pod event is newer', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime();
    const failed = createPod(workloadId, 'uid-failed');
    const running = createPod(workloadId, 'uid-running', 'my-api-def');
    const fresh = createPod(workloadId, 'uid-fresh', 'my-api-ghi');
    const freshAt = listedAt + 500;

    // Both old Pods were observed before the list started, so their absence
    // from the list is authoritative.
    jest.setSystemTime(new Date(listedAt - 1_000));
    store.applyPod('add', failed);
    store.applyPod('add', running);

    // One Pod event lands after the list started; it must not pin the two
    // siblings the list no longer reports.
    jest.setSystemTime(new Date(freshAt));
    store.applyPod('add', fresh);
    store.replaceAll([], [], listedAt);

    expect(store.get(workloadId)?.pods).toEqual([fresh]);
    expect(store.deploymentObservedAt(workloadId)).toBe(listedAt);
  });

  it('does not resurrect a Pod deleted after the list started', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime();
    const deleted = createPod(workloadId, 'uid-deleted');
    const surviving = createPod(workloadId, 'uid-surviving', 'my-api-def');
    const deletedAt = listedAt + 500;

    jest.setSystemTime(new Date(deletedAt));
    store.applyPod('delete', deleted);
    // The list request started before the delete, so it still reports it.
    store.replaceAll([], [deleted, surviving], listedAt);

    expect(store.get(workloadId)?.pods).toEqual([surviving]);
    expect(store.deploymentObservedAt(workloadId)).toBe(listedAt);
  });

  it('keeps an updated Pod and takes the list value for an untouched sibling', () => {
    const store = new WorkloadSnapshotStore();
    const listedAt = NOW.getTime();
    const storedSibling = createPod(workloadId, 'uid-1');
    const listedSibling: V1Pod = {
      ...storedSibling,
      status: { phase: 'Succeeded' },
    };
    const eventPod: V1Pod = {
      ...createPod(workloadId, 'uid-2', 'my-api-def'),
      status: { phase: 'Failed' },
    };
    const eventAt = listedAt + 500;

    jest.setSystemTime(new Date(listedAt - 1_000));
    store.applyPod('add', storedSibling);
    jest.setSystemTime(new Date(eventAt));
    store.applyPod('update', eventPod);
    store.replaceAll([], [listedSibling], listedAt);

    expect(store.get(workloadId)?.pods).toEqual([listedSibling, eventPod]);
    expect(store.deploymentObservedAt(workloadId)).toBe(listedAt);
  });

  it('keeps a live id whose entry predates the sweep', () => {
    const store = new WorkloadSnapshotStore();

    store.applyDeployment('add', createDeployment(workloadId));
    store.retain(new Set([workloadId]), NOW.getTime() + 1_000);

    expect(store.ids()).toEqual([workloadId]);
    expect(store.get(workloadId)?.deployment).toBeDefined();
  });

  it('drops an unbacked tombstone observed at the sweep start', () => {
    const store = new WorkloadSnapshotStore();

    store.applyDeployment('delete', createDeployment(workloadId));
    store.retain(new Set(), NOW.getTime());

    expect(store.ids()).toEqual([]);
    expect(store.get(workloadId)).toBeUndefined();
    expect(store.deploymentObservedAt(workloadId)).toBe(0);
  });

  it('keeps an unbacked entry touched after the sweep started', () => {
    const store = new WorkloadSnapshotStore();
    const sweepStartedAt = NOW.getTime();
    const pod = createPod(workloadId, 'uid-1');

    store.applyDeployment('delete', createDeployment(workloadId));
    jest.setSystemTime(new Date(sweepStartedAt + 500));
    store.applyPod('add', pod);
    store.retain(new Set(), sweepStartedAt);

    expect(store.ids()).toEqual([workloadId]);
    expect(store.get(workloadId)?.pods).toEqual([pod]);
  });

  it('never throws on malformed objects', () => {
    const store = new WorkloadSnapshotStore();
    const malformed = [
      null,
      undefined,
      {},
      { metadata: null },
      { metadata: { labels: null } },
      { metadata: { labels: 'invalid' } },
      { metadata: { labels: { [WORKLOAD_ID_LABEL]: 42 } } },
    ];

    for (const object of malformed) {
      expect(() =>
        store.applyDeployment('add', object as unknown as V1Deployment),
      ).not.toThrow();
      expect(() =>
        store.applyPod('update', object as unknown as V1Pod),
      ).not.toThrow();
      expect(() =>
        store.applyDeployment('delete', object as unknown as V1Deployment),
      ).not.toThrow();
    }

    expect(() =>
      store.replaceAll(
        [null, {}, { metadata: {} }] as unknown as V1Deployment[],
        [undefined, { metadata: { labels: null } }] as unknown as V1Pod[],
        NOW.getTime(),
      ),
    ).not.toThrow();
    expect(store.ids()).toEqual([]);
  });
});
