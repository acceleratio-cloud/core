import type { V1Deployment } from '@kubernetes/client-node';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadStatusDeriverRegistry } from '../../workload-status-deriver.registry';
import type { WorkloadEventsService } from '../workload-events.service';
import { WorkloadSnapshotStore } from '../workload-snapshot.store';
import {
  CLUSTER_UNREADABLE_MESSAGE,
  DEPLOYMENT_MISSING_MESSAGE,
  WorkloadStatusService,
  type WorkloadStatusRow,
} from '../workload-status.service';

// The Kubernetes client is ESM-only and Jest runs CommonJS; the service only
// needs the class token here.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const WORKLOAD_ID_LABEL = 'acceleratio.io/workload-id';

const deployedRow: WorkloadStatusRow = {
  id: workloadId,
  project_id: projectId,
  type: 'docker',
  external_name: 'my-api',
  last_deployed_at: new Date('2026-11-01T10:00:00.000Z'),
  updated_at: new Date('2026-11-01T10:30:00.000Z'),
};
const draftRow: WorkloadStatusRow = { ...deployedRow, last_deployed_at: null };

const deployment = (resourceVersion = '10'): V1Deployment => ({
  metadata: {
    name: 'my-api',
    uid: 'deployment-uid',
    resourceVersion,
    labels: { [WORKLOAD_ID_LABEL]: workloadId },
  },
  spec: { replicas: 1, selector: { matchLabels: {} }, template: {} },
});

const notFound = () => Object.assign(new Error('not found'), { code: 404 });

const createHarness = (rows: WorkloadStatusRow[] = [deployedRow]) => {
  const snapshot = new WorkloadSnapshotStore();
  const derive = jest.fn(
    (input: { deployment: V1Deployment }): Promise<unknown> =>
      Promise.resolve({
        status:
          input.deployment.metadata?.resourceVersion === '11'
            ? 'deploying'
            : 'running',
        status_message: null,
      }),
  );
  const registry = {
    get: jest.fn((type: string) =>
      type === 'docker' ? { derive } : undefined,
    ),
  } as unknown as WorkloadStatusDeriverRegistry;
  const publish = jest.fn();
  const events = { publish } as unknown as WorkloadEventsService;
  const appsV1 = { readNamespacedDeployment: jest.fn() };
  const coreV1 = {
    listNamespacedPod: jest.fn().mockResolvedValue({ items: [] }),
  };
  const kubernetes = { appsV1, coreV1 } as unknown as KubernetesService;
  let current = rows;
  // Every query step returns itself, and awaiting it yields the current rows.
  const query: Record<string, unknown> = {};

  for (const step of ['from', 'where']) {
    query[step] = jest.fn(() => query);
  }

  query.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(current).then(onFulfilled, onRejected);

  const db = { select: jest.fn(() => query) } as unknown as Database;
  const service = new WorkloadStatusService(
    db,
    snapshot,
    registry,
    events,
    kubernetes,
  );

  return {
    service,
    snapshot,
    derive,
    publish,
    appsV1,
    coreV1,
    setRows: (next: WorkloadStatusRow[]) => {
      current = next;
    },
  };
};

describe('WorkloadStatusService.resolve', () => {
  it('derives the status from the snapshot Deployment', async () => {
    const { service, snapshot, derive } = createHarness();

    snapshot.applyDeployment('add', deployment());

    const view = await service.resolve(deployedRow);

    expect(derive).toHaveBeenCalledWith(
      expect.objectContaining({ deployment: deployment() }),
    );
    expect(view).toMatchObject({ status: 'running', status_message: null });
    expect(view.status_observed_at).not.toBeNull();
  });

  it('is a draft before the first deploy, with no cluster lookup', async () => {
    const { service, snapshot, appsV1 } = createHarness();

    snapshot.replaceAll([], [], Date.now());

    await expect(service.resolve(draftRow)).resolves.toMatchObject({
      status: 'draft',
    });
    expect(appsV1.readNamespacedDeployment).not.toHaveBeenCalled();
  });

  it('fails a deployed workload whose Deployment is gone from a listed cluster', async () => {
    const { service, snapshot, appsV1 } = createHarness();

    snapshot.replaceAll([], [], Date.now());

    await expect(service.resolve(deployedRow)).resolves.toMatchObject({
      status: 'failed',
      status_message: DEPLOYMENT_MISSING_MESSAGE,
    });
    expect(appsV1.readNamespacedDeployment).not.toHaveBeenCalled();
  });

  describe('before the snapshot has listed the cluster', () => {
    it('asks the cluster directly', async () => {
      const { service, appsV1, coreV1 } = createHarness();

      appsV1.readNamespacedDeployment.mockResolvedValue(deployment());

      await expect(service.resolve(deployedRow)).resolves.toMatchObject({
        status: 'running',
      });
      expect(appsV1.readNamespacedDeployment).toHaveBeenCalledWith({
        name: 'my-api',
        namespace: `project-${projectId}`,
      });
      expect(coreV1.listNamespacedPod).toHaveBeenCalledWith({
        namespace: `project-${projectId}`,
        labelSelector: `${WORKLOAD_ID_LABEL}=${workloadId}`,
      });
    });

    it('reports a missing Deployment', async () => {
      const { service, appsV1 } = createHarness();

      appsV1.readNamespacedDeployment.mockRejectedValue(notFound());

      await expect(service.resolve(deployedRow)).resolves.toMatchObject({
        status: 'failed',
        status_message: DEPLOYMENT_MISSING_MESSAGE,
      });
    });

    it('reports an unreachable cluster without throwing', async () => {
      const { service, appsV1 } = createHarness();

      appsV1.readNamespacedDeployment.mockRejectedValue(new Error('timeout'));

      await expect(service.resolve(deployedRow)).resolves.toMatchObject({
        status: 'failed',
        status_message: CLUSTER_UNREADABLE_MESSAGE,
      });
    });
  });

  it('shows an applied Deployment at once, before any watch event', async () => {
    const { service, snapshot } = createHarness();

    snapshot.applyDeployment('add', deployment('10'));
    service.applyDeployment(deployment('11'));

    await expect(service.resolve(deployedRow)).resolves.toMatchObject({
      status: 'deploying',
    });

    // The watch event for the previous revision arrives late.
    snapshot.applyDeployment('update', deployment('10'));

    await expect(service.resolve(deployedRow)).resolves.toMatchObject({
      status: 'deploying',
    });
  });
});

describe('WorkloadStatusService events', () => {
  it('publishes a status once and only again when it changes', async () => {
    const { service, snapshot, publish } = createHarness();

    snapshot.applyDeployment('add', deployment('10'));
    await service.announceChanges([workloadId]);
    await service.announceChanges([workloadId]);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      type: 'status',
      workload_id: workloadId,
      project_id: projectId,
      status: 'running',
      status_message: null,
      status_observed_at: expect.stringMatching(/^\d{4}-/) as string,
      updated_at: '2026-11-01T10:30:00.000Z',
    });

    snapshot.applyDeployment('update', deployment('11'));
    await service.announceChanges([workloadId]);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'deploying' }),
    );
  });

  it('remembers workloads on the first sweep without announcing them', async () => {
    const { service, snapshot, publish } = createHarness();

    snapshot.replaceAll([deployment('10')], [], Date.now());
    await service.reconcileAll();

    expect(publish).not.toHaveBeenCalled();

    snapshot.applyDeployment('update', deployment('11'));
    await service.reconcileAll();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'deploying' }),
    );
  });

  it('announces an action even when nothing was announced before', async () => {
    const { service, snapshot, publish } = createHarness();

    snapshot.applyDeployment('add', deployment('10'));
    await service.announce(deployedRow);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
    );
  });

  it('ignores workload types without a deriver', async () => {
    const { service, publish } = createHarness([
      { ...deployedRow, type: 's3_bucket' },
    ]);

    await service.announceChanges([workloadId]);

    expect(publish).not.toHaveBeenCalled();
  });

  it('forgets deleted workloads so a recreated id is announced again', async () => {
    const { service, snapshot, publish, setRows } = createHarness();

    snapshot.applyDeployment('add', deployment('10'));
    await service.announceChanges([workloadId]);
    service.forget(workloadId);
    await service.announceChanges([workloadId]);

    expect(publish).toHaveBeenCalledTimes(2);

    setRows([]);
    await service.reconcileAll();
    await service.announceChanges([workloadId]);

    expect(publish).toHaveBeenCalledTimes(2);
  });
});
