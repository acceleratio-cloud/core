import type { V1Deployment } from '@kubernetes/client-node';
import type { WorkloadType } from '@acceleratio/shared';
import type { ProjectIsolationService } from '@/application/project/project-isolation.service';
import type { ProjectService } from '@/application/project/project.service';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadEventsService } from '../../observer/workload-events.service';
import type { WorkloadMutationGuard } from '../../observer/workload-mutation-guard';
import type { WorkloadRow } from '../../schemas/workload.schema';
import type { WorkloadVersionRow } from '../../schemas/workload-version.schema';
import type { WorkloadVersionService } from '../../workload-version.service';
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
const activeVersionId = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
const olderVersionId = '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e';

const activeVersion: WorkloadVersionRow = {
  id: activeVersionId,
  workload_id: workloadId,
  number: 2,
  config: { docker_image: 'nginx:1.25' },
  source_version_id: null,
  created_at: new Date('2026-11-01T10:00:00.000Z'),
};

const olderVersion: WorkloadVersionRow = {
  id: olderVersionId,
  workload_id: workloadId,
  number: 1,
  config: { docker_image: 'nginx:1.24' },
  source_version_id: null,
  created_at: new Date('2026-11-01T09:10:00.000Z'),
};

const baseRow: WorkloadRow = {
  id: workloadId,
  project_id: projectId,
  name: 'My API',
  type: 'docker',
  active_version_id: activeVersionId,
  draft_config: null,
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
  const insertValues = jest.fn().mockReturnValue({ returning });
  const insert = jest.fn().mockReturnValue({ values: insertValues });
  const updateWhere = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });
  const deleteWhere = jest.fn();
  const remove = jest.fn().mockReturnValue({ where: deleteWhere });

  return {
    db: { select, insert, update, delete: remove } as unknown as Database,
    select,
    selectWhere,
    orderBy,
    limit,
    insert,
    insertValues,
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
  const versionsFake = {
    findByIds: jest.fn((ids: string[]) => {
      const known = [activeVersion, olderVersion];

      return Promise.resolve(
        new Map(
          known
            .filter((version) => ids.includes(version.id))
            .map((version) => [version.id, version]),
        ),
      );
    }),
    list: jest.fn(),
    get: jest.fn(),
    record: jest.fn(),
    clearAppliedDraft: jest.fn(),
  };
  const service = new DockerWorkloadService(
    database.db,
    projectService,
    isolation,
    kubernetes,
    guard,
    events,
    versionsFake as unknown as WorkloadVersionService,
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
    versions: versionsFake,
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

  it('attaches the active version and the draft of every row', async () => {
    const { service, orderBy, versions } = createService();
    const draftRow: WorkloadRow = {
      ...baseRow,
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      active_version_id: null,
      draft_config: { docker_image: 'redis:7' },
      status: 'draft',
    };

    orderBy.mockResolvedValue([baseRow, draftRow]);

    const result = await service.list(projectId);

    expect(versions.findByIds).toHaveBeenCalledTimes(1);
    expect(versions.findByIds).toHaveBeenCalledWith([activeVersionId]);
    expect(result[0].active_version).toMatchObject({
      id: activeVersionId,
      number: 2,
      config: { docker_image: 'nginx:1.25' },
    });
    expect(result[0].draft_config).toBeNull();
    expect(result[1].active_version).toBeNull();
    expect(result[1].draft_config).toEqual({ docker_image: 'redis:7' });
  });
});

describe('DockerWorkloadService.update', () => {
  it('persists a position and publishes a position event', async () => {
    const { service, limit, set, returning, publish, appsV1 } = createService();
    const moved: WorkloadRow = {
      ...baseRow,
      position: { x: 120, y: 40 },
      updated_at: new Date('2026-11-02T10:00:01.000Z'),
    };

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([moved]);

    const result = await service.update(projectId, workloadId, {
      position: { x: 120, y: 40 },
    });

    expect(set).toHaveBeenCalledWith({ position: { x: 120, y: 40 } });
    expect(publish).toHaveBeenCalledWith({
      type: 'position',
      workload_id: workloadId,
      project_id: projectId,
      position: { x: 120, y: 40 },
      updated_at: '2026-11-02T10:00:01.000Z',
    });
    expect(result.position).toEqual({ x: 120, y: 40 });
    expect(appsV1.replaceNamespacedDeployment).not.toHaveBeenCalled();
  });

  it('treats a drop on the stored coordinates as a no-op', async () => {
    const { service, limit, update, publish } = createService();

    limit.mockResolvedValue([baseRow]);

    const result = await service.update(projectId, workloadId, {
      position: { x: 0, y: 0 },
    });

    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(result.position).toEqual({ x: 0, y: 0 });
  });

  it('does not publish a position event for a rename', async () => {
    const { service, limit, returning, publish } = createService();
    const renamed: WorkloadRow = {
      ...baseRow,
      name: 'Renamed',
      updated_at: new Date('2026-11-02T10:00:01.000Z'),
    };

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([renamed]);

    await service.update(projectId, workloadId, { name: 'Renamed' });

    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a position with non-numeric coordinates', async () => {
    const { service, limit, update, publish } = createService();

    limit.mockResolvedValue([baseRow]);

    await expect(
      service.update(projectId, workloadId, {
        position: { x: 'left', y: 0 } as unknown as {
          x: number;
          y: number;
        },
      }),
    ).rejects.toThrow('position must contain numeric x and y');
    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('DockerWorkloadService.create', () => {
  it('places a new workload in the first free grid slot', async () => {
    const { service, exists, selectWhere, insert, insertValues, returning } =
      createService();
    const created: WorkloadRow = {
      ...baseRow,
      position: { x: 640, y: 0 },
    };

    exists.mockResolvedValue(true);
    selectWhere.mockResolvedValueOnce([
      { position: { x: 0, y: 0 } },
      { position: { x: 320, y: 0 } },
    ]);
    returning.mockResolvedValue([created]);

    await service.create(projectId, {
      name: 'Worker',
      type: 'docker',
      config: { docker_image: 'nginx:1.25' },
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(firstArgument(insertValues)).toMatchObject({
      project_id: projectId,
      name: 'Worker',
      type: 'docker',
      draft_config: { docker_image: 'nginx:1.25' },
      position: { x: 640, y: 0 },
    });
    expect(firstArgument(insertValues)).not.toHaveProperty('active_version_id');
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
      type: 'status',
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
      type: 'status',
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
      type: 'status',
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

describe('DockerWorkloadService versions', () => {
  const deployedState = (
    overrides: Partial<WorkloadRow> = {},
  ): WorkloadRow => ({
    ...baseRow,
    status: 'deploying',
    updated_at: new Date('2026-11-02T10:00:01.000Z'),
    ...overrides,
  });

  const appliedDeployment = (appsV1: {
    createNamespacedDeployment: jest.Mock;
  }) =>
    (
      firstArgument(appsV1.createNamespacedDeployment) as {
        body: V1Deployment;
      }
    ).body;

  it('stores a config change as a draft without touching the cluster', async () => {
    const { service, limit, set, returning, appsV1 } = createService();

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([
      { ...baseRow, draft_config: { docker_image: 'nginx:1.26' } },
    ]);

    const result = await service.update(projectId, workloadId, {
      config: { docker_image: ' nginx:1.26 ' },
    });

    expect(set).toHaveBeenCalledWith({
      draft_config: { docker_image: 'nginx:1.26' },
    });
    expect(result.draft_config).toEqual({ docker_image: 'nginx:1.26' });
    expect(result.active_version?.config).toEqual({
      docker_image: 'nginx:1.25',
    });
    expect(appsV1.replaceNamespacedDeployment).not.toHaveBeenCalled();
  });

  it('drops the draft when the config is edited back to the active one', async () => {
    const { service, limit, set, returning } = createService();
    const withDraft: WorkloadRow = {
      ...baseRow,
      draft_config: { docker_image: 'nginx:1.26' },
    };

    limit.mockResolvedValue([withDraft]);
    returning.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: { docker_image: 'nginx:1.25' },
    });

    expect(set).toHaveBeenCalledWith({ draft_config: null });
  });

  it('ignores a config equal to the active one when there is no draft', async () => {
    const { service, limit, update } = createService();

    limit.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: { docker_image: 'nginx:1.25' },
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('deploys the draft as a new version after the cluster accepts it', async () => {
    const { service, limit, returning, appsV1, versions } = createService();
    const withDraft: WorkloadRow = {
      ...baseRow,
      draft_config: { docker_image: 'nginx:1.26' },
    };

    limit.mockResolvedValue([withDraft]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([deployedState()]);

    await service.deploy(projectId, workloadId);

    const deployment = appliedDeployment(appsV1);
    const recorded = firstArgument(versions.record) as {
      id: string;
      workloadId: string;
      config: unknown;
      appliedDraft: unknown;
    };

    expect(deployment.spec?.template.spec?.containers[0].image).toBe(
      'nginx:1.26',
    );
    expect(recorded).toMatchObject({
      workloadId,
      config: { docker_image: 'nginx:1.26' },
      appliedDraft: { docker_image: 'nginx:1.26' },
    });
    expect(
      deployment.spec?.template.metadata?.annotations?.[
        'acceleratio.io/workload-version-id'
      ],
    ).toBe(recorded.id);
    expect(recorded.id).not.toBe(activeVersionId);
    expect(
      appsV1.createNamespacedDeployment.mock.invocationCallOrder[0],
    ).toBeLessThan(versions.record.mock.invocationCallOrder[0]);
  });

  it('reapplies the active version without a new one when there is no draft', async () => {
    const { service, limit, returning, appsV1, versions } = createService();

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([deployedState()]);

    await service.deploy(projectId, workloadId);

    expect(
      appliedDeployment(appsV1).spec?.template.metadata?.annotations?.[
        'acceleratio.io/workload-version-id'
      ],
    ).toBe(activeVersionId);
    expect(versions.record).not.toHaveBeenCalled();
    expect(versions.clearAppliedDraft).not.toHaveBeenCalled();
  });

  it('records no version when the cluster rejects the deploy', async () => {
    const { service, limit, appsV1, versions, set } = createService();

    limit.mockResolvedValue([
      { ...baseRow, draft_config: { docker_image: 'nginx:1.26' } },
    ]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockRejectedValue(
      new Error('admission denied'),
    );

    await expect(service.deploy(projectId, workloadId)).rejects.toThrow();
    expect(versions.record).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses to deploy a workload with neither a draft nor a version', async () => {
    const { service, limit, appsV1 } = createService();

    limit.mockResolvedValue([
      { ...baseRow, active_version_id: null, draft_config: null },
    ]);

    await expect(service.deploy(projectId, workloadId)).rejects.toThrow(
      'Workload has no config to deploy',
    );
    expect(appsV1.readNamespacedDeployment).not.toHaveBeenCalled();
  });

  it('starts the active version and leaves the draft pending', async () => {
    const { service, limit, returning, appsV1, versions } = createService();

    limit.mockResolvedValue([
      {
        ...baseRow,
        status: 'stopped',
        draft_config: { docker_image: 'nginx:1.26' },
      },
    ]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([deployedState()]);

    await service.start(projectId, workloadId);

    expect(
      appliedDeployment(appsV1).spec?.template.spec?.containers[0].image,
    ).toBe('nginx:1.25');
    expect(versions.record).not.toHaveBeenCalled();
    expect(versions.clearAppliedDraft).not.toHaveBeenCalled();
  });

  it('refuses to start a workload that was never deployed', async () => {
    const { service, limit } = createService();

    limit.mockResolvedValue([
      {
        ...baseRow,
        active_version_id: null,
        draft_config: { docker_image: 'nginx:1.26' },
      },
    ]);

    await expect(service.start(projectId, workloadId)).rejects.toThrow(
      'Workload is not deployed yet',
    );
  });

  it('rolls back by applying an older config as a new version', async () => {
    const { service, limit, returning, appsV1, versions } = createService();
    const withDraft: WorkloadRow = {
      ...baseRow,
      draft_config: { docker_image: 'nginx:1.26' },
    };

    limit.mockResolvedValue([withDraft]);
    versions.get.mockResolvedValue(olderVersion);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([deployedState()]);

    await service.rollback(projectId, workloadId, olderVersionId);

    const recorded = firstArgument(versions.record) as Record<string, unknown>;

    expect(versions.get).toHaveBeenCalledWith(workloadId, olderVersionId);
    expect(
      appliedDeployment(appsV1).spec?.template.spec?.containers[0].image,
    ).toBe('nginx:1.24');
    expect(recorded).toMatchObject({
      workloadId,
      config: { docker_image: 'nginx:1.24' },
      sourceVersionId: olderVersionId,
    });
    expect(recorded.id).not.toBe(olderVersionId);
    // The draft stays for a later deploy.
    expect(recorded.appliedDraft).toBeUndefined();
  });

  it('refuses to roll back to the active version', async () => {
    const { service, limit, versions, appsV1 } = createService();

    limit.mockResolvedValue([baseRow]);
    versions.get.mockResolvedValue(activeVersion);

    await expect(
      service.rollback(projectId, workloadId, activeVersionId),
    ).rejects.toThrow('Version is already active');
    expect(appsV1.readNamespacedDeployment).not.toHaveBeenCalled();
  });

  it('lists versions of a workload in the project scope', async () => {
    const { service, limit, versions } = createService();

    limit.mockResolvedValue([baseRow]);
    versions.list.mockResolvedValue([activeVersion, olderVersion]);

    const result = await service.listVersions(projectId, workloadId);

    expect(versions.list).toHaveBeenCalledWith(workloadId);
    expect(result.map((version) => version.number)).toEqual([2, 1]);
    expect(result[0].created_at).toBe('2026-11-01T10:00:00.000Z');
  });

  it('discards a draft of a deployed workload', async () => {
    const { service, limit, set, returning } = createService();

    limit.mockResolvedValue([
      { ...baseRow, draft_config: { docker_image: 'nginx:1.26' } },
    ]);
    returning.mockResolvedValue([baseRow]);

    const result = await service.discardDraft(projectId, workloadId);

    expect(set).toHaveBeenCalledWith({ draft_config: null });
    expect(result.draft_config).toBeNull();
  });

  it('keeps the only config of a workload that was never deployed', async () => {
    const { service, limit, update } = createService();

    limit.mockResolvedValue([
      {
        ...baseRow,
        active_version_id: null,
        draft_config: { docker_image: 'nginx:1.26' },
      },
    ]);

    await expect(service.discardDraft(projectId, workloadId)).rejects.toThrow(
      'its draft is its only config',
    );
    expect(update).not.toHaveBeenCalled();
  });
});
