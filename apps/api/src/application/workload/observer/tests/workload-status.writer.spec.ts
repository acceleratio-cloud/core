import { Logger } from '@nestjs/common';
import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { WorkloadStatus, WorkloadType } from '@acceleratio/shared';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { DerivedWorkloadStatus } from '../../docker/docker-workload.status';
import { WORKLOAD_ID_LABEL } from '../../docker/docker-workload.manifests';
import type { WorkloadRow } from '../../schemas/workload.schema';
import type { WorkloadStatusDeriver } from '../../workload-status-deriver';
import type { WorkloadStatusDeriverRegistry } from '../../workload-status-deriver.registry';
import type { WorkloadEventsService } from '../workload-events.service';
import type { WorkloadMutationGuard } from '../workload-mutation-guard';
import {
  WorkloadSnapshotStore,
  type WorkloadSnapshot,
} from '../workload-snapshot.store';
import {
  NAMESPACE_CACHE_TTL_MS,
  WorkloadStatusWriter,
} from '../workload-status.writer';

// @kubernetes/client-node is ESM-only and Jest runs CommonJS. The writer
// only needs the class for dependency injection; the client itself is faked.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const otherWorkloadId = '7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f';
const externalName = 'my-api-3f9a1b2c';
const namespace = `project-${projectId}`;
const driftMessage = 'Deployment is missing from the cluster';
const observedDate = new Date('2026-11-02T10:00:00.000Z');
const updatedDate = new Date('2026-11-02T10:00:01.000Z');

const createRow = (overrides: Partial<WorkloadRow> = {}): WorkloadRow => ({
  id: workloadId,
  project_id: projectId,
  name: 'My API',
  type: 'docker',
  active_version_id: null,
  draft_config: { docker_image: 'nginx:1.25' },
  position: { x: 0, y: 0 },
  external_name: externalName,
  internal_hostname: null,
  storage_class_id: null,
  status: 'deploying',
  status_message: null,
  status_observed_at: null,
  last_deployed_at: new Date('2026-11-01T10:00:00.000Z'),
  created_at: new Date('2026-11-01T09:00:00.000Z'),
  updated_at: new Date('2026-11-01T09:30:00.000Z'),
  ...overrides,
});

const createDeployment = (): V1Deployment => ({
  metadata: { name: externalName },
  spec: { replicas: 1, selector: { matchLabels: {} }, template: {} },
  status: {
    conditions: [{ type: 'Available', status: 'True' }],
    updatedReplicas: 1,
    unavailableReplicas: 0,
  },
});

const createPod = (): V1Pod => ({
  metadata: { name: 'my-api-abc' },
  status: { phase: 'Running' },
});

const createLabeledDeployment = (): V1Deployment => ({
  ...createDeployment(),
  metadata: {
    name: externalName,
    labels: { [WORKLOAD_ID_LABEL]: workloadId },
  },
});

const createLabeledPod = (): V1Pod => ({
  ...createPod(),
  metadata: {
    name: 'my-api-abc',
    labels: { [WORKLOAD_ID_LABEL]: workloadId },
  },
});

const createDeriver = (result: DerivedWorkloadStatus) => {
  const derive = jest.fn(() => result);
  const deriver: WorkloadStatusDeriver = { type: 'docker', derive };

  return { deriver, derive };
};

const createSnapshotStore = () => {
  const entries = new Map<string, WorkloadSnapshot>();
  const observations = new Map<string, number>();
  const get = jest.fn((id: string) => entries.get(id));
  const deploymentObservedAt = jest.fn(
    (id: string) => observations.get(id) ?? 0,
  );
  const retain = jest.fn();
  const store = {
    get,
    deploymentObservedAt,
    retain,
  } as unknown as WorkloadSnapshotStore;

  return {
    store,
    get,
    deploymentObservedAt,
    retain,
    set(id: string, snapshot: WorkloadSnapshot, at = 0) {
      entries.set(id, snapshot);
      observations.set(id, at);
    },
  };
};

const createMutationGuard = () => {
  const mutations = new Map<string, number>();
  const mutatedAt = jest.fn((id: string) => mutations.get(id) ?? 0);
  const noteMutation = jest.fn((id: string) => {
    mutations.set(id, Date.now());
  });
  const guard = {
    mutatedAt,
    noteMutation,
  } as unknown as WorkloadMutationGuard;

  return {
    guard,
    mutatedAt,
    noteMutation,
    mutate(id: string, at: number) {
      mutations.set(id, at);
    },
  };
};

const createRegistry = (deriver: WorkloadStatusDeriver | undefined) => {
  const get = jest.fn(() => deriver);
  const registry = { get } as unknown as WorkloadStatusDeriverRegistry;

  return { registry, get };
};

const createEvents = () => {
  const publish = jest.fn();
  const events = { publish } as unknown as WorkloadEventsService;

  return { events, publish };
};

/**
 * The values passed to `.set(...)`. `status_observed_at` stays `unknown` so
 * assertions can use `expect.any(Date)` without an unsafe assignment.
 */
interface PersistedStatus {
  status: WorkloadStatus;
  status_message: string | null;
  status_observed_at: unknown;
}

/**
 * Flushes the pending microtasks until `condition` holds. Deferred promises
 * replace sleeps so every ordering below is deterministic.
 */
const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let index = 0; index < 50 && !condition(); index += 1) {
    await Promise.resolve();
  }

  expect(condition()).toBe(true);
};

/** Drains a fixed number of microtasks, whether or not work is still queued. */
const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
};

/**
 * `select().from(...)` is awaited directly by `reconcileAll` and chained with
 * `.where(...)` by `write`, so each query is a promise that also exposes the
 * `where` method.
 */
const createDatabase = () => {
  const state = {
    all: [] as WorkloadRow[],
    selected: [] as WorkloadRow[],
  };
  const where = jest.fn(() => Promise.resolve(state.selected));
  const from = jest.fn(() =>
    Object.assign(Promise.resolve(state.all), { where }),
  );
  const select = jest.fn(() => ({ from }));
  const returning = jest.fn();
  const updateWhere = jest.fn<{ returning: jest.Mock }, [unknown]>(() => ({
    returning,
  }));
  const set = jest.fn<{ where: jest.Mock }, [PersistedStatus]>(() => ({
    where: updateWhere,
  }));
  const update = jest.fn(() => ({ set }));

  return {
    db: { select, update } as unknown as Database,
    select,
    from,
    where,
    update,
    set,
    returning,
    updateWhere,
    setRows(all: WorkloadRow[], selected = all) {
      state.all = all;
      state.selected = selected;
    },
  };
};

/** Renders an update `WHERE` clause so a test can inspect its guard. */
const renderWhere = (clause: unknown): { sql: string; params: unknown[] } => {
  const rendered = new PgDialect().sqlToQuery(clause as SQL);

  return { sql: rendered.sql, params: rendered.params };
};

interface HarnessOptions {
  /** `null` makes the registry report an unknown workload type. */
  deriver?: WorkloadStatusDeriver | null;
  /** Uses the real store instead of the fake one. */
  snapshotStore?: WorkloadSnapshotStore;
}

const createWriter = (options: HarnessOptions = {}) => {
  const database = createDatabase();
  const snapshot = createSnapshotStore();
  const guard = createMutationGuard();
  const fallback = createDeriver({ status: 'running', status_message: null });
  const registryDeriver =
    options.deriver === undefined
      ? fallback.deriver
      : (options.deriver ?? undefined);
  const registry = createRegistry(registryDeriver);
  const events = createEvents();
  const readNamespace = jest.fn();
  const kubernetes = {
    coreV1: { readNamespace },
  } as unknown as KubernetesService;

  const writer = new WorkloadStatusWriter(
    database.db,
    options.snapshotStore ?? snapshot.store,
    guard.guard,
    registry.registry,
    events.events,
    kubernetes,
  );

  return {
    writer,
    database,
    snapshot,
    guard,
    registry,
    events,
    readNamespace,
    deriver: fallback,
  };
};

describe('WorkloadStatusWriter.write', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns without querying when there are no ids', async () => {
    const { writer, database } = createWriter();

    await writer.write([]);

    expect(database.select).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });

  it('writes a changed status and publishes exactly one event', async () => {
    const { writer, database, snapshot, events, deriver } = createWriter();
    const row = createRow();
    const deployment = createDeployment();
    const pods = [createPod()];

    database.setRows([row]);
    snapshot.set(workloadId, { deployment, deploymentObserved: true, pods });
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'running',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.write([workloadId]);

    expect(deriver.derive).toHaveBeenCalledWith({ deployment, pods });
    expect(database.set).toHaveBeenCalledWith<[PersistedStatus]>({
      status: 'running',
      status_message: null,
      status_observed_at: expect.any(Date),
    });
    expect(database.update).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledWith({
      type: 'status',
      workload_id: workloadId,
      project_id: projectId,
      status: 'running',
      status_message: null,
      status_observed_at: observedDate.toISOString(),
      updated_at: updatedDate.toISOString(),
    });
  });

  it('writes when only the status message changes', async () => {
    const changed = createDeriver({
      status: 'failed',
      status_message: 'ImagePullBackOff',
    });
    const { writer, database, snapshot, events } = createWriter({
      deriver: changed.deriver,
    });
    const row = createRow({
      status: 'failed',
      status_message: 'CrashLoopBackOff',
    });

    database.setRows([row]);
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });
    database.returning.mockResolvedValue([
      {
        ...row,
        status_message: 'ImagePullBackOff',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.write([workloadId]);

    expect(database.set).toHaveBeenCalledWith<[PersistedStatus]>({
      status: 'failed',
      status_message: 'ImagePullBackOff',
      status_observed_at: expect.any(Date),
    });
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing when the conditional update matches no row', async () => {
    const { writer, database, snapshot, events } = createWriter();
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const row = createRow();

    database.setRows([row]);
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });
    // An action committed between the revalidation and the UPDATE, so the
    // guarded statement matches no row.
    database.returning.mockResolvedValue([]);

    await expect(writer.write([workloadId])).resolves.toBeUndefined();

    expect(database.update).toHaveBeenCalledTimes(1);
    expect(events.publish).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('guards the final update with the observed status and null message', async () => {
    const { writer, database, snapshot } = createWriter();
    const row = createRow();

    database.setRows([row]);
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'running',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.write([workloadId]);

    expect(database.updateWhere).toHaveBeenCalledTimes(1);

    const rendered = renderWhere(database.updateWhere.mock.calls[0][0]);

    expect(rendered.params).toEqual([
      workloadId,
      'deploying',
      row.updated_at.toISOString(),
    ]);
    expect(rendered.params.some((param) => param instanceof Date)).toBe(false);
    expect(rendered.sql).toContain('"workload"."status" = $2');
    expect(rendered.sql).toContain('"workload"."status_message" is null');
    expect(rendered.sql).toContain(
      `date_trunc('milliseconds', "workload"."updated_at") = $3::timestamp`,
    );
  });

  it('guards the final update with the observed status message', async () => {
    const changed = createDeriver({
      status: 'failed',
      status_message: 'ImagePullBackOff',
    });
    const { writer, database, snapshot } = createWriter({
      deriver: changed.deriver,
    });
    const row = createRow({
      status: 'failed',
      status_message: 'CrashLoopBackOff',
    });

    database.setRows([row]);
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });
    database.returning.mockResolvedValue([
      {
        ...row,
        status_message: 'ImagePullBackOff',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.write([workloadId]);

    const rendered = renderWhere(database.updateWhere.mock.calls[0][0]);

    expect(rendered.params).toEqual([
      workloadId,
      'failed',
      'CrashLoopBackOff',
      row.updated_at.toISOString(),
    ]);
    expect(rendered.params.some((param) => param instanceof Date)).toBe(false);
    expect(rendered.sql).toContain('"workload"."status_message" = $3');
    expect(rendered.sql).toContain(
      `date_trunc('milliseconds', "workload"."updated_at") = $4::timestamp`,
    );
  });

  it('binds the observed updated_at when an action rewrote the same status', async () => {
    const { writer, database, snapshot, events } = createWriter();
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const observedUpdatedAt = new Date('2026-11-01T09:30:00.000Z');
    const actionUpdatedAt = new Date('2026-11-01T09:31:00.000Z');
    const row = createRow({ updated_at: observedUpdatedAt });

    database.setRows([row]);
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });
    // A redeploy rewrote `deploying`/null, so the action row differs from the
    // one read above only in `updated_at`. The fake database cannot evaluate
    // the statement, so the guard is asserted through its rendered form: it
    // carries the observed timestamp and therefore cannot match the action.
    database.returning.mockResolvedValue([]);

    await writer.write([workloadId]);

    const rendered = renderWhere(database.updateWhere.mock.calls[0][0]);

    expect(rendered.params).toEqual([
      workloadId,
      'deploying',
      observedUpdatedAt.toISOString(),
    ]);
    expect(rendered.params).not.toContainEqual(actionUpdatedAt.toISOString());
    expect(rendered.params.some((param) => param instanceof Date)).toBe(false);
    expect(rendered.sql).toContain(
      `date_trunc('milliseconds', "workload"."updated_at") = $3::timestamp`,
    );
    expect(events.publish).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('does not write or publish when status and message match', async () => {
    const { writer, database, snapshot, events } = createWriter();
    const row = createRow({ status: 'running' });

    database.setRows([row]);
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();
    expect(database.returning).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('skips a row observed at the mutation time', async () => {
    const { writer, database, snapshot, guard, events } = createWriter();

    database.setRows([createRow()]);
    snapshot.set(
      workloadId,
      { deployment: createDeployment(), deploymentObserved: true, pods: [] },
      5,
    );
    guard.mutate(workloadId, 5);

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('skips a row observed before the mutation time', async () => {
    const { writer, database, snapshot, guard, events } = createWriter();

    database.setRows([createRow()]);
    snapshot.set(
      workloadId,
      { deployment: createDeployment(), deploymentObserved: true, pods: [] },
      4,
    );
    guard.mutate(workloadId, 5);

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('writes when the observation is newer than the mutation', async () => {
    const { writer, database, snapshot, guard, events } = createWriter();
    const row = createRow();

    database.setRows([row]);
    snapshot.set(
      workloadId,
      { deployment: createDeployment(), deploymentObserved: true, pods: [] },
      6,
    );
    guard.mutate(workloadId, 5);
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'running',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.write([workloadId]);

    expect(database.update).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('does not release the mutation fence on a Pod event', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(observedDate);

    const store = new WorkloadSnapshotStore();
    const { writer, database, guard, events } = createWriter({
      snapshotStore: store,
    });
    const row = createRow();

    database.setRows([row]);
    store.applyDeployment('add', createLabeledDeployment());

    // The action lands after the cached Deployment was observed.
    await jest.advanceTimersByTimeAsync(5);
    guard.guard.noteMutation(workloadId);

    // A fresh Pod event arrives, but the Deployment part still predates the
    // action: the fence must hold and the row must not be written.
    await jest.advanceTimersByTimeAsync(5);
    store.applyPod('add', createLabeledPod());

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();

    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'running',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    // A Deployment event after the action releases the fence.
    await jest.advanceTimersByTimeAsync(5);
    store.applyDeployment('add', createLabeledDeployment());

    await writer.write([workloadId]);

    expect(database.set).toHaveBeenCalledWith<[PersistedStatus]>({
      status: 'running',
      status_message: null,
      status_observed_at: expect.any(Date),
    });
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('does not treat a pod-only entry as drift', async () => {
    const { writer, database, snapshot, events, readNamespace } =
      createWriter();

    database.setRows([createRow({ status: 'running' })]);
    snapshot.set(workloadId, {
      deploymentObserved: false,
      pods: [createPod()],
    });

    await writer.write([workloadId]);

    expect(readNamespace).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('derives running after a pod event is followed by a deployment add', async () => {
    const store = new WorkloadSnapshotStore();
    const { writer, database, events } = createWriter({
      snapshotStore: store,
    });
    const row = createRow();

    database.setRows([row]);
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'running',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    store.applyPod('add', createLabeledPod());

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();

    store.applyDeployment('add', createLabeledDeployment());

    await writer.write([workloadId]);

    expect(database.set).toHaveBeenCalledWith<[PersistedStatus]>({
      status: 'running',
      status_message: null,
      status_observed_at: expect.any(Date),
    });
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('marks a deployed workload failed after a Deployment delete event', async () => {
    const { writer, database, snapshot, events, readNamespace } =
      createWriter();
    const row = createRow({ status: 'running' });

    database.setRows([row]);
    snapshot.set(workloadId, { deploymentObserved: true, pods: [] });
    readNamespace.mockResolvedValue({});
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'failed',
        status_message: driftMessage,
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.write([workloadId]);

    expect(readNamespace).toHaveBeenCalledWith({ name: namespace });
    expect(database.set).toHaveBeenCalledWith<[PersistedStatus]>({
      status: 'failed',
      status_message: driftMessage,
      status_observed_at: expect.any(Date),
    });
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        status_message: driftMessage,
      }),
    );
  });

  it('skips a row whose project namespace is gone', async () => {
    const { writer, database, snapshot, events, readNamespace } =
      createWriter();

    database.setRows([createRow({ status: 'running' })]);
    snapshot.set(workloadId, { deploymentObserved: true, pods: [] });
    readNamespace.mockRejectedValue({ code: 404 });

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('skips and logs when the namespace probe fails', async () => {
    const { writer, database, snapshot, events, readNamespace } =
      createWriter();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    database.setRows([createRow({ status: 'running' })]);
    snapshot.set(workloadId, { deploymentObserved: true, pods: [] });
    readNamespace.mockRejectedValue(new Error('cluster unavailable'));

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries the namespace probe after a transient error', async () => {
    const { writer, database, snapshot, events, readNamespace } =
      createWriter();
    const first = createRow({ status: 'running' });
    const second = createRow({
      id: otherWorkloadId,
      name: 'Other API',
      external_name: 'other-api-7c1d2e3f',
      status: 'running',
    });

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    database.setRows([first, second]);
    snapshot.set(workloadId, { deploymentObserved: true, pods: [] });
    snapshot.set(otherWorkloadId, { deploymentObserved: true, pods: [] });
    readNamespace
      .mockRejectedValueOnce(new Error('cluster unavailable'))
      .mockResolvedValueOnce({});
    database.returning.mockResolvedValue([
      {
        ...second,
        status: 'failed',
        status_message: driftMessage,
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.write([workloadId, otherWorkloadId]);

    expect(readNamespace).toHaveBeenCalledTimes(2);
    expect(database.update).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('probes a namespace once for rows in the same project', async () => {
    const { writer, database, snapshot, events, readNamespace } =
      createWriter();
    const first = createRow({ status: 'running' });
    const second = createRow({
      id: otherWorkloadId,
      name: 'Other API',
      external_name: 'other-api-7c1d2e3f',
      status: 'running',
    });
    const failed = (row: WorkloadRow): WorkloadRow => ({
      ...row,
      status: 'failed',
      status_message: driftMessage,
      status_observed_at: observedDate,
      updated_at: updatedDate,
    });

    database.setRows([first, second]);
    snapshot.set(workloadId, { deploymentObserved: true, pods: [] });
    snapshot.set(otherWorkloadId, { deploymentObserved: true, pods: [] });
    readNamespace.mockResolvedValue({});
    database.returning
      .mockResolvedValueOnce([failed(first)])
      .mockResolvedValueOnce([failed(second)]);

    await writer.write([workloadId, otherWorkloadId]);

    expect(readNamespace).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledTimes(2);
  });

  it('probes a namespace again after the cache expires', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(observedDate);

    const { writer, database, snapshot, readNamespace } = createWriter();
    const row = createRow({ status: 'running' });

    database.setRows([row]);
    snapshot.set(workloadId, { deploymentObserved: true, pods: [] });
    readNamespace.mockResolvedValue({});
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'failed',
        status_message: driftMessage,
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.write([workloadId]);
    jest.advanceTimersByTime(NAMESPACE_CACHE_TTL_MS + 1);
    await writer.write([workloadId]);

    expect(readNamespace).toHaveBeenCalledTimes(2);
  });

  it('skips ids with no database row', async () => {
    const { writer, database, snapshot, events } = createWriter();

    database.setRows([], []);
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('quietly skips a workload type that owns its status', async () => {
    const { writer, database, snapshot, events } = createWriter({
      deriver: null,
    });
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    database.setRows([createRow({ type: 'future' as WorkloadType })]);
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });

    await writer.write([workloadId]);

    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips the write when a user action lands during the namespace probe', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(observedDate);

    const store = new WorkloadSnapshotStore();
    const { writer, database, guard, events, readNamespace } = createWriter({
      snapshotStore: store,
    });
    const row = createRow({ status: 'running' });
    let resolveProbe: (value: unknown) => void = () => undefined;

    database.setRows([row]);
    store.applyDeployment('delete', createLabeledDeployment());
    readNamespace.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = resolve;
        }),
    );

    const writing = writer.write([workloadId]);

    await waitFor(() => readNamespace.mock.calls.length === 1);

    guard.guard.noteMutation(workloadId);
    resolveProbe({});
    await writing;

    expect(database.update).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('re-derives when a Deployment arrives during the namespace probe', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(observedDate);

    const store = new WorkloadSnapshotStore();
    const { writer, database, deriver, events, readNamespace } = createWriter({
      snapshotStore: store,
    });
    const row = createRow({ status: 'deploying' });
    const deployment = createLabeledDeployment();
    let resolveProbe: (value: unknown) => void = () => undefined;

    database.setRows([row]);
    store.applyDeployment('delete', deployment);
    readNamespace.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'running',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    const writing = writer.write([workloadId]);

    await waitFor(() => readNamespace.mock.calls.length === 1);

    await jest.advanceTimersByTimeAsync(5);
    store.applyDeployment('add', deployment);
    resolveProbe({});
    await writing;

    expect(deriver.derive).toHaveBeenCalledWith({ deployment, pods: [] });
    expect(database.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(database.set).toHaveBeenCalledWith<[PersistedStatus]>({
      status: 'running',
      status_message: null,
      status_observed_at: expect.any(Date),
    });
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('writes the fresh status when a Deployment arrives after the action', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(observedDate);

    const store = new WorkloadSnapshotStore();
    const { writer, database, guard, deriver, events, readNamespace } =
      createWriter({ snapshotStore: store });
    const row = createRow({ status: 'deploying' });
    const deployment = createLabeledDeployment();
    let resolveProbe: (value: unknown) => void = () => undefined;

    database.setRows([row]);
    store.applyDeployment('delete', deployment);
    readNamespace.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'running',
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    const writing = writer.write([workloadId]);

    await waitFor(() => readNamespace.mock.calls.length === 1);

    guard.guard.noteMutation(workloadId);
    await jest.advanceTimersByTimeAsync(5);
    store.applyDeployment('add', deployment);
    resolveProbe({});
    await writing;

    expect(deriver.derive).toHaveBeenCalledWith({ deployment, pods: [] });
    expect(database.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(database.set).toHaveBeenCalledWith<[PersistedStatus]>({
      status: 'running',
      status_message: null,
      status_observed_at: expect.any(Date),
    });
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent writes so the older status is never persisted last', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(observedDate);

    const store = new WorkloadSnapshotStore();
    const { writer, database, deriver, events } = createWriter({
      snapshotStore: store,
    });
    const row = createRow({ status: 'deploying' });
    let resolveFirstPersist: () => void = () => undefined;

    database.setRows([row]);
    store.applyDeployment('add', createLabeledDeployment());
    database.returning
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstPersist = () =>
            resolve([
              {
                ...row,
                status: 'failed',
                status_message: 'stale',
                status_observed_at: observedDate,
                updated_at: updatedDate,
              },
            ]);
        }),
      )
      .mockResolvedValueOnce([
        {
          ...row,
          status: 'running',
          status_message: null,
          status_observed_at: observedDate,
          updated_at: updatedDate,
        },
      ]);
    deriver.derive
      .mockReturnValueOnce({ status: 'failed', status_message: 'stale' })
      .mockReturnValueOnce({ status: 'running', status_message: null });

    const first = writer.write([workloadId]);

    await waitFor(() => database.update.mock.calls.length === 1);

    // The second call is enqueued behind the first, whose persist is
    // deliberately still pending.
    const second = writer.write([workloadId]);

    await flushMicrotasks();
    resolveFirstPersist();
    await Promise.all([first, second]);

    expect(events.publish).toHaveBeenCalledTimes(2);
    expect(events.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(events.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'running' }),
    );
  });
});

describe('WorkloadStatusWriter.reconcileAll', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retains the snapshot entries the sweep rows back', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(observedDate);

    const { writer, database, snapshot } = createWriter();
    const row = createRow({ status: 'running' });
    const staleId = '4a2b3c4d-5e6f-4a7b-8c9d-0a1b2c3d4e5f';

    database.setRows([row]);
    // The live row keeps its entry; a tombstone for a deleted row has to go.
    snapshot.set(workloadId, {
      deployment: createDeployment(),
      deploymentObserved: true,
      pods: [],
    });
    snapshot.set(staleId, { deploymentObserved: true, pods: [] });

    await writer.reconcileAll();

    expect(snapshot.retain).toHaveBeenCalledTimes(1);
    expect(snapshot.retain).toHaveBeenCalledWith(
      new Set([workloadId]),
      observedDate.getTime(),
    );
  });

  it('detects drift without a snapshot entry and drafts a never-deployed row', async () => {
    const { writer, database, events, readNamespace } = createWriter();
    const drifted = createRow({ status: 'running' });
    const neverDeployed = createRow({
      id: otherWorkloadId,
      name: 'Other API',
      external_name: 'other-api-7c1d2e3f',
      status: 'deploying',
      last_deployed_at: null,
    });

    database.setRows([drifted, neverDeployed]);
    readNamespace.mockResolvedValue({});
    database.returning
      .mockResolvedValueOnce([
        {
          ...drifted,
          status: 'failed',
          status_message: driftMessage,
          status_observed_at: observedDate,
          updated_at: updatedDate,
        },
      ])
      .mockResolvedValueOnce([
        {
          ...neverDeployed,
          status: 'draft',
          status_message: null,
          status_observed_at: observedDate,
          updated_at: updatedDate,
        },
      ]);

    await writer.reconcileAll();

    expect(database.where).not.toHaveBeenCalled();
    expect(database.set).toHaveBeenNthCalledWith<[PersistedStatus]>(1, {
      status: 'failed',
      status_message: driftMessage,
      status_observed_at: expect.any(Date),
    });
    expect(database.set).toHaveBeenNthCalledWith<[PersistedStatus]>(2, {
      status: 'draft',
      status_message: null,
      status_observed_at: expect.any(Date),
    });
    expect(events.publish).toHaveBeenCalledTimes(2);
    expect(events.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(events.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'draft' }),
    );
  });

  it('marks drift in the full sweep for a pod-only entry', async () => {
    const { writer, database, snapshot, events, readNamespace } =
      createWriter();
    const row = createRow({ status: 'running' });

    database.setRows([row]);
    snapshot.set(workloadId, {
      deploymentObserved: false,
      pods: [],
    });
    readNamespace.mockResolvedValue({});
    database.returning.mockResolvedValue([
      {
        ...row,
        status: 'failed',
        status_message: driftMessage,
        status_observed_at: observedDate,
        updated_at: updatedDate,
      },
    ]);

    await writer.reconcileAll();

    expect(readNamespace).toHaveBeenCalledWith({ name: namespace });
    expect(database.set).toHaveBeenCalledWith<[PersistedStatus]>({
      status: 'failed',
      status_message: driftMessage,
      status_observed_at: expect.any(Date),
    });
    expect(events.publish).toHaveBeenCalledTimes(1);
  });
});
