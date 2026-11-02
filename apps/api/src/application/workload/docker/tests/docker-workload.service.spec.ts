import type { V1Deployment } from '@kubernetes/client-node';
import type { WorkloadType } from '@acceleratio/shared';
import type { ProjectIsolationService } from '@/application/project/project-isolation.service';
import type { ProjectService } from '@/application/project/project.service';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadEventsService } from '../../observer/workload-events.service';
import type { WorkloadMutationGuard } from '../../observer/workload-mutation-guard';
import type { WorkloadRow } from '../../schemas/workload.schema';
import { DockerWorkloadService } from '../docker-workload.service';

// @kubernetes/client-node is ESM-only and Jest runs CommonJS. None of these
// collaborators is exercised through a real client; only the classes are
// needed to construct the service.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('@/application/project/project.service', () => ({
  ProjectService: class ProjectService {},
}));
jest.mock('@/application/project/project-isolation.service', () => ({
  ProjectIsolationService: class ProjectIsolationService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const externalName = 'my-api-3f9a1b2c';
const namespace = `project-${projectId}`;

const baseRow: WorkloadRow = {
  id: workloadId,
  project_id: projectId,
  name: 'My API',
  type: 'docker',
  config: { docker_image: 'nginx:1.25' },
  position: { x: 0, y: 0 },
  external_name: externalName,
  status: 'running',
  status_message: null,
  status_observed_at: null,
  last_deployed_at: new Date('2026-11-01T10:00:00.000Z'),
  created_at: new Date('2026-11-01T09:00:00.000Z'),
  updated_at: new Date('2026-11-01T09:30:00.000Z'),
};

const createDeployment = (): V1Deployment => ({
  metadata: { name: externalName },
  spec: {
    replicas: 1,
    selector: { matchLabels: {} },
    template: {},
  },
});

/**
 * Drizzle SQL nodes keep bound values on nested `Param` chunks. Collecting
 * them lets a test assert the type scope without a real database.
 */
const queryParams = (node: unknown): unknown[] => {
  const values: unknown[] = [];

  const visit = (current: unknown): void => {
    if (typeof current !== 'object' || current === null) {
      return;
    }

    const record = current as { value?: unknown; queryChunks?: unknown };

    if (record.constructor?.name === 'Param') {
      values.push(record.value);
    }

    if (Array.isArray(record.queryChunks)) {
      for (const chunk of record.queryChunks) {
        visit(chunk);
      }
    }
  };

  visit(node);

  return values;
};

const firstArgument = (mock: jest.Mock): unknown =>
  (mock.mock.calls as unknown[][])[0]?.[0];

const createDatabase = () => {
  const orderBy = jest.fn();
  const limit = jest.fn();
  const selectWhere = jest.fn().mockReturnValue({ orderBy, limit });
  const from = jest.fn().mockReturnValue({ where: selectWhere });
  const select = jest.fn().mockReturnValue({ from });
  const returning = jest.fn();
  const updateWhere = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });
  const deleteWhere = jest.fn();
  const remove = jest.fn().mockReturnValue({ where: deleteWhere });

  return {
    db: { select, update, delete: remove } as unknown as Database,
    select,
    selectWhere,
    orderBy,
    limit,
    update,
    set,
    returning,
    remove,
    deleteWhere,
  };
};

const createService = () => {
  const database = createDatabase();
  const appsV1 = {
    // `list()` must never reach Kubernetes. A rejecting stub turns an
    // accidental call into a failed test instead of a silent success.
    listNamespacedDeployment: jest
      .fn()
      .mockRejectedValue(new Error('list() must not call Kubernetes')),
    readNamespacedDeployment: jest.fn(),
    createNamespacedDeployment: jest.fn(),
    replaceNamespacedDeployment: jest.fn(),
    deleteNamespacedDeployment: jest.fn(),
  };
  const coreV1 = {
    listNamespacedPod: jest
      .fn()
      .mockRejectedValue(new Error('list() must not call Kubernetes')),
  };
  const kubernetes = { appsV1, coreV1 } as unknown as KubernetesService;
  const exists = jest.fn();
  const projectService = { exists } as unknown as ProjectService;
  const ensure = jest.fn();
  const isolation = {
    ensure,
    remove: jest.fn(),
  } as unknown as ProjectIsolationService;
  const noteMutation = jest.fn();
  const guard = { noteMutation } as unknown as WorkloadMutationGuard;
  const publish = jest.fn();
  const events = { publish } as unknown as WorkloadEventsService;
  const service = new DockerWorkloadService(
    database.db,
    projectService,
    isolation,
    kubernetes,
    guard,
    events,
  );

  return {
    service,
    ...database,
    appsV1,
    coreV1,
    ensure,
    exists,
    noteMutation,
    publish,
  };
};

describe('DockerWorkloadService.list', () => {
  it('returns stored rows without calling Kubernetes', async () => {
    const { service, orderBy, update, appsV1, coreV1 } = createService();
    const stored: WorkloadRow = {
      ...baseRow,
      status: 'failed',
      status_message: 'previous failure',
    };

    orderBy.mockResolvedValue([stored]);

    const result = await service.list(projectId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: workloadId,
      status: 'failed',
      status_message: 'previous failure',
    });
    expect(appsV1.listNamespacedDeployment).not.toHaveBeenCalled();
    expect(coreV1.listNamespacedPod).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('strips a legacy port from the config returned to the API', async () => {
    const { service, orderBy, update } = createService();
    const legacyRow = {
      ...baseRow,
      config: { docker_image: 'nginx:1.25', port: 8080 },
    } as WorkloadRow;

    orderBy.mockResolvedValue([legacyRow]);

    const result = await service.list(projectId);

    expect(result).toHaveLength(1);
    expect(result[0].config).toEqual({ docker_image: 'nginx:1.25' });
    expect(result[0].config).not.toHaveProperty('port');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('DockerWorkloadService lifecycle actions', () => {
  it('deploys a missing Deployment and publishes the optimistic status', async () => {
    const {
      service,
      limit,
      set,
      returning,
      appsV1,
      ensure,
      noteMutation,
      publish,
    } = createService();
    const deployed: WorkloadRow = {
      ...baseRow,
      status: 'deploying',
      status_message: null,
      status_observed_at: new Date('2026-11-02T10:00:00.000Z'),
      last_deployed_at: new Date('2026-11-02T10:00:00.000Z'),
      updated_at: new Date('2026-11-02T10:00:01.000Z'),
    };

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([deployed]);

    const result = await service.deploy(projectId, workloadId);

    expect(ensure).toHaveBeenCalledWith(projectId);
    expect(appsV1.createNamespacedDeployment).toHaveBeenCalledTimes(1);
    expect(noteMutation).toHaveBeenCalledWith(workloadId);
    expect(set).toHaveBeenCalledTimes(1);

    const persisted = firstArgument(set) as {
      status?: string;
      status_message?: string | null;
      last_deployed_at?: Date;
    };

    expect(persisted.status).toBe('deploying');
    expect(persisted.status_message).toBeNull();
    expect(persisted.last_deployed_at).toBeInstanceOf(Date);
    expect(publish).toHaveBeenCalledWith({
      workload_id: workloadId,
      project_id: projectId,
      status: 'deploying',
      status_message: null,
      status_observed_at: '2026-11-02T10:00:00.000Z',
      updated_at: '2026-11-02T10:00:01.000Z',
    });
    expect(result).toMatchObject({ id: workloadId, status: 'deploying' });
  });

  it('stops a Deployment and publishes the optimistic status', async () => {
    const { service, limit, set, returning, appsV1, noteMutation, publish } =
      createService();
    const stopped: WorkloadRow = {
      ...baseRow,
      status: 'stopped',
      status_message: null,
      status_observed_at: new Date('2026-11-02T10:00:00.000Z'),
      updated_at: new Date('2026-11-02T10:00:01.000Z'),
    };

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(createDeployment());
    appsV1.replaceNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([stopped]);

    const result = await service.stop(projectId, workloadId);

    const replace = firstArgument(appsV1.replaceNamespacedDeployment) as {
      name?: string;
      namespace?: string;
      body?: { spec?: { replicas?: number } };
    };

    expect(replace.name).toBe(externalName);
    expect(replace.namespace).toBe(namespace);
    expect(replace.body?.spec?.replicas).toBe(0);
    expect(noteMutation).toHaveBeenCalledWith(workloadId);
    expect(set).toHaveBeenCalledWith({
      status: 'stopped',
      status_message: null,
    });
    expect(publish).toHaveBeenCalledWith({
      workload_id: workloadId,
      project_id: projectId,
      status: 'stopped',
      status_message: null,
      status_observed_at: '2026-11-02T10:00:00.000Z',
      updated_at: '2026-11-02T10:00:01.000Z',
    });
    expect(result).toMatchObject({ id: workloadId, status: 'stopped' });
  });

  it('restarts a Deployment with a new deployment time and publishes', async () => {
    const { service, limit, set, returning, appsV1, noteMutation, publish } =
      createService();
    const restarted: WorkloadRow = {
      ...baseRow,
      status: 'deploying',
      status_message: null,
      status_observed_at: new Date('2026-11-02T10:00:00.000Z'),
      last_deployed_at: new Date('2026-11-02T10:00:00.000Z'),
      updated_at: new Date('2026-11-02T10:00:01.000Z'),
    };
    const before = Date.now();

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(createDeployment());
    appsV1.replaceNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([restarted]);

    const result = await service.restart(projectId, workloadId);

    expect(appsV1.replaceNamespacedDeployment).toHaveBeenCalledTimes(1);
    expect(noteMutation).toHaveBeenCalledWith(workloadId);
    expect(set).toHaveBeenCalledTimes(1);

    const persisted = firstArgument(set) as {
      status?: string;
      status_message?: string | null;
      last_deployed_at?: Date;
    };

    expect(persisted.status).toBe('deploying');
    expect(persisted.status_message).toBeNull();
    expect(persisted.last_deployed_at?.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(publish).toHaveBeenCalledWith({
      workload_id: workloadId,
      project_id: projectId,
      status: 'deploying',
      status_message: null,
      status_observed_at: '2026-11-02T10:00:00.000Z',
      updated_at: '2026-11-02T10:00:01.000Z',
    });
    expect(result).toMatchObject({ id: workloadId, status: 'deploying' });
  });

  it('removes the Deployment and the row, then fences the observer', async () => {
    const { service, limit, deleteWhere, appsV1, noteMutation, publish } =
      createService();

    limit.mockResolvedValue([baseRow]);
    appsV1.deleteNamespacedDeployment.mockResolvedValue({});
    deleteWhere.mockResolvedValue(undefined);

    await service.remove(projectId, workloadId);

    expect(appsV1.deleteNamespacedDeployment).toHaveBeenCalledWith({
      name: externalName,
      namespace,
    });
    expect(noteMutation).toHaveBeenCalledWith(workloadId);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('DockerWorkloadService type scope', () => {
  it('lists only docker rows of the project', async () => {
    const { service, selectWhere, orderBy } = createService();

    orderBy.mockResolvedValue([]);

    await service.list(projectId);

    expect(selectWhere).toHaveBeenCalledTimes(1);
    expect(queryParams(firstArgument(selectWhere))).toEqual(
      expect.arrayContaining([projectId, 'docker']),
    );
  });

  it('reads a row only when it belongs to the project and the docker type', async () => {
    const { service, selectWhere, limit } = createService();

    limit.mockResolvedValue([baseRow]);

    const result = await service.get(projectId, workloadId);

    expect(result).toMatchObject({
      id: workloadId,
      type: 'docker',
      external_name: externalName,
      namespace,
    });
    expect(queryParams(firstArgument(selectWhere))).toEqual(
      expect.arrayContaining([workloadId, projectId, 'docker']),
    );
  });

  it('reports a missing or non-docker row as not found', async () => {
    const { service, limit } = createService();

    limit.mockResolvedValue([]);

    await expect(service.get(projectId, workloadId)).rejects.toThrow(
      'Workload not found',
    );
  });

  it('rejects a payload of another type before inserting a row', async () => {
    const { service, exists } = createService();

    exists.mockResolvedValue(true);

    await expect(
      service.create(projectId, {
        name: 'Worker',
        type: 'future' as WorkloadType,
        config: { docker_image: 'nginx:1.25' },
      }),
    ).rejects.toThrow('Unsupported workload type');
  });
});
