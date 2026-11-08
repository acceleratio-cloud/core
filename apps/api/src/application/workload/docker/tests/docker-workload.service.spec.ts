import { ConflictException } from '@nestjs/common';
import type { V1Deployment } from '@kubernetes/client-node';
import type { WorkloadType } from '@acceleratio/shared';
import type { ProjectIsolationService } from '@/application/project/project-isolation.service';
import type { ProjectService } from '@/application/project/project.service';
import type { StorageClassService } from '@/application/storage-class/storage-class.service';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadEventsService } from '../../observer/workload-events.service';
import type {
  WorkloadStatusService,
  WorkloadStatusView,
} from '../../observer/workload-status.service';
import type { WorkloadRow } from '../../schemas/workload.schema';
import type { WorkloadVersionRow } from '../../schemas/workload-version.schema';
import type { WorkloadVersionService } from '../../workload-version.service';
import type { DockerWorkloadNetworkService } from '../docker-workload-network.service';
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
jest.mock('@/application/storage-class/storage-class.service', () => ({
  StorageClassService: class StorageClassService {},
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
  created_by_id: null,
  created_by_name: null,
  created_by_email: null,
  created_by_github_login: null,
  created_at: new Date('2026-11-01T10:00:00.000Z'),
};

const olderVersion: WorkloadVersionRow = {
  id: olderVersionId,
  workload_id: workloadId,
  number: 1,
  config: { docker_image: 'nginx:1.24' },
  source_version_id: null,
  created_by_id: null,
  created_by_name: null,
  created_by_email: null,
  created_by_github_login: null,
  created_at: new Date('2026-11-01T09:10:00.000Z'),
};

const baseRow: WorkloadRow = {
  id: workloadId,
  auto_deploy: true,
  project_id: projectId,
  name: 'My API',
  type: 'docker',
  active_version_id: activeVersionId,
  draft_config: null,
  position: { x: 0, y: 0 },
  external_name: externalName,
  internal_hostname: 'my-api',
  storage_class_id: null,
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
    listNamespacedReplicaSet: jest.fn().mockResolvedValue({ items: [] }),
    createNamespacedDeployment: jest.fn(),
    replaceNamespacedDeployment: jest.fn(),
    deleteNamespacedDeployment: jest.fn(),
  };
  const coreV1 = {
    listNamespacedPod: jest
      .fn()
      .mockRejectedValue(new Error('list() must not call Kubernetes')),
    listNamespacedSecret: jest.fn().mockResolvedValue({ items: [] }),
    createNamespacedSecret: jest.fn(),
    deleteNamespacedSecret: jest.fn(),
    listNamespacedPersistentVolumeClaim: jest
      .fn()
      .mockResolvedValue({ items: [] }),
    listPersistentVolumeClaimForAllNamespaces: jest
      .fn()
      .mockResolvedValue({ items: [] }),
    createNamespacedPersistentVolumeClaim: jest.fn(),
    readNamespacedPersistentVolumeClaim: jest.fn(),
    deleteNamespacedPersistentVolumeClaim: jest.fn(),
  };
  const kubernetes = { appsV1, coreV1 } as unknown as KubernetesService;
  const exists = jest.fn();
  const projectService = { exists } as unknown as ProjectService;
  const ensure = jest.fn();
  const isolation = {
    ensure,
    remove: jest.fn(),
  } as unknown as ProjectIsolationService;
  // The status comes from the cluster snapshot; these tests choose what the
  // snapshot says and check that actions put their Deployment into it.
  const view: WorkloadStatusView = {
    status: 'running',
    status_message: null,
    status_observed_at: '2026-11-02T10:00:00.000Z',
  };
  const status = {
    resolve: jest.fn(() => Promise.resolve(view)),
    resolveAll: jest.fn((rows: { id: string }[]) =>
      Promise.resolve(new Map(rows.map((row) => [row.id, view]))),
    ),
    applyDeployment: jest.fn(),
    announce: jest.fn(() => Promise.resolve(view)),
    forget: jest.fn(),
  };
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
    resolveSide: jest.fn(),
  };
  const network = {
    removeAll: jest.fn(),
    ensureInternalService: jest.fn().mockResolvedValue(undefined),
    takenServiceNames: jest.fn().mockResolvedValue(new Set<string>()),
    assignInternalHostname: jest.fn((row: WorkloadRow) => Promise.resolve(row)),
    renameInternalHostname: jest.fn((row: WorkloadRow) => Promise.resolve(row)),
    ensureDnsRule: jest.fn().mockResolvedValue(undefined),
  };
  const storageClasses = {
    kubernetesName: jest.fn((id: string | null) =>
      Promise.resolve(id === null ? 'seaweedfs-storage' : `sc-${id}`),
    ),
    assertVolumeProfile: jest.fn(() => Promise.resolve()),
  };
  const service = new DockerWorkloadService(
    database.db,
    projectService,
    isolation,
    kubernetes,
    status as unknown as WorkloadStatusService,
    events,
    versionsFake as unknown as WorkloadVersionService,
    network as unknown as DockerWorkloadNetworkService,
    storageClasses as unknown as StorageClassService,
  );

  return {
    service,
    network,
    ...database,
    appsV1,
    coreV1,
    ensure,
    exists,
    status,
    publish,
    storageClasses,
    versions: versionsFake,
  };
};

describe('DockerWorkloadService.list', () => {
  it('reads the status from the cluster snapshot and never writes it', async () => {
    const { service, orderBy, update, appsV1, coreV1, status } =
      createService();

    orderBy.mockResolvedValue([baseRow]);
    status.resolveAll.mockResolvedValue(
      new Map([
        [
          workloadId,
          {
            status: 'failed',
            status_message: 'ImagePullBackOff',
            status_observed_at: '2026-11-02T10:00:00.000Z',
          },
        ],
      ]) as never,
    );

    const result = await service.list(projectId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: workloadId,
      status: 'failed',
      status_message: 'ImagePullBackOff',
      status_observed_at: '2026-11-02T10:00:00.000Z',
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
      draft_config: {
        docker_image: 'nginx:1.25',
        cpu_max: null,
        ram_max: null,
      },
      position: { x: 640, y: 0 },
    });
    expect(firstArgument(insertValues)).not.toHaveProperty('active_version_id');
  });

  it('keeps limits the request sets and leaves the rest unlimited', async () => {
    const { service, exists, selectWhere, insertValues, returning } =
      createService();

    exists.mockResolvedValue(true);
    selectWhere.mockResolvedValueOnce([]);
    returning.mockResolvedValue([baseRow]);

    await service.create(projectId, {
      name: 'Worker',
      type: 'docker',
      config: { docker_image: 'nginx:1.25', ram_max: 512 },
    });

    expect(firstArgument(insertValues)).toMatchObject({
      draft_config: { docker_image: 'nginx:1.25', cpu_max: null, ram_max: 512 },
    });
  });
});

describe('DockerWorkloadService private hostname', () => {
  it('names a new service after its slug and skips names used in the project', async () => {
    const { service, exists, selectWhere, insertValues, returning, network } =
      createService();

    exists.mockResolvedValue(true);
    selectWhere.mockResolvedValueOnce([]);
    network.takenServiceNames.mockResolvedValue(
      new Set(['postgres', 'postgres-2']),
    );
    returning.mockResolvedValue([
      { ...baseRow, internal_hostname: 'postgres-3' },
    ]);

    const created = await service.create(projectId, {
      name: 'Postgres',
      type: 'docker',
      config: { docker_image: 'postgres:17' },
    });

    expect(network.takenServiceNames).toHaveBeenCalledWith(projectId);
    expect(firstArgument(insertValues)).toMatchObject({
      internal_hostname: 'postgres-3',
    });
    expect(created).toMatchObject({
      internal_hostname: 'postgres-3',
      internal_domain: 'postgres-3.internal',
    });
  });

  it('picks again when a concurrent create took the hostname', async () => {
    const { service, exists, selectWhere, insertValues, returning, network } =
      createService();
    const conflict = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'workload_project_id_internal_hostname_unique',
    });

    exists.mockResolvedValue(true);
    selectWhere.mockResolvedValueOnce([]);
    network.takenServiceNames
      .mockResolvedValueOnce(new Set())
      .mockResolvedValueOnce(new Set(['postgres']));
    returning
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce([{ ...baseRow, internal_hostname: 'postgres-2' }]);

    await service.create(projectId, {
      name: 'Postgres',
      type: 'docker',
      config: { docker_image: 'postgres:17' },
    });

    expect(
      insertValues.mock.calls.map(
        ([values]: [{ internal_hostname: string }]) => values.internal_hostname,
      ),
    ).toEqual(['postgres', 'postgres-2']);
  });

  it('deploys without the private name when another Service holds it', async () => {
    const { service, limit, returning, appsV1, network } = createService();

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    network.ensureInternalService.mockRejectedValue(
      new ConflictException('taken'),
    );
    returning.mockResolvedValue([baseRow]);

    await expect(service.deploy(projectId, workloadId)).resolves.toMatchObject({
      id: workloadId,
    });
    expect(appsV1.createNamespacedDeployment).toHaveBeenCalledTimes(1);
  });

  it('names a service created before private names on its next deploy', async () => {
    const { service, limit, returning, appsV1, network } = createService();
    const legacy = { ...baseRow, internal_hostname: null };

    limit.mockResolvedValue([legacy]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    network.assignInternalHostname.mockResolvedValue(baseRow);
    returning.mockResolvedValue([baseRow]);

    await service.deploy(projectId, workloadId);

    expect(network.assignInternalHostname).toHaveBeenCalledWith(legacy);
    expect(network.ensureInternalService).toHaveBeenCalledWith(baseRow);
  });

  it('renames only after a deploy in flight has finished', async () => {
    const { service, limit, returning, appsV1, network } = createService();
    const order: string[] = [];
    let finishDeployment!: () => void;

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDeployment = () => {
            order.push('deployment');
            resolve({});
          };
        }),
    );
    network.renameInternalHostname.mockImplementation((row: WorkloadRow) => {
      order.push('rename');
      return Promise.resolve(row);
    });
    returning.mockResolvedValue([baseRow]);

    const deploying = service.deploy(projectId, workloadId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const renaming = service.updateInternalHostname(projectId, workloadId, {
      internal_hostname: 'postgres',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual([]);
    finishDeployment();
    await deploying;
    await renaming;

    expect(order).toEqual(['deployment', 'rename']);
  });

  it('backfills names and private Services of existing services', async () => {
    const { service, selectWhere, limit, network } = createService();
    const legacy = { ...baseRow, internal_hostname: null };

    selectWhere.mockResolvedValueOnce([legacy]);
    limit.mockResolvedValue([legacy]);
    network.assignInternalHostname.mockResolvedValue(baseRow);

    await service.backfillPrivateNetwork();

    expect(network.ensureDnsRule).toHaveBeenCalledTimes(1);
    expect(network.ensureInternalService).toHaveBeenCalledWith(baseRow);
  });

  it('writes the private Service before the Deployment on deploy', async () => {
    const { service, limit, returning, appsV1, network } = createService();
    const order: string[] = [];

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    network.ensureInternalService.mockImplementation(() => {
      order.push('service');
      return Promise.resolve();
    });
    appsV1.createNamespacedDeployment.mockImplementation(() => {
      order.push('deployment');
      return Promise.resolve({});
    });
    returning.mockResolvedValue([baseRow]);

    await service.deploy(projectId, workloadId);

    expect(network.ensureInternalService).toHaveBeenCalledWith(
      expect.objectContaining({ id: workloadId, internal_hostname: 'my-api' }),
    );
    expect(order).toEqual(['service', 'deployment']);
  });
});

describe('DockerWorkloadService lifecycle actions', () => {
  const rolling: WorkloadStatusView = {
    status: 'deploying',
    status_message: null,
    status_observed_at: '2026-11-02T10:00:00.000Z',
  };

  it('deploys a missing Deployment and puts it into the snapshot', async () => {
    const { service, limit, set, returning, appsV1, ensure, status } =
      createService();
    const created = { metadata: { name: externalName, generation: 1 } };
    const deployed: WorkloadRow = {
      ...baseRow,
      last_deployed_at: new Date('2026-11-02T10:00:00.000Z'),
      updated_at: new Date('2026-11-02T10:00:01.000Z'),
    };

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue(created);
    returning.mockResolvedValue([deployed]);
    status.announce.mockResolvedValue(rolling);

    const result = await service.deploy(projectId, workloadId);

    expect(ensure).toHaveBeenCalledWith(projectId);
    expect(appsV1.createNamespacedDeployment).toHaveBeenCalledTimes(1);
    expect(status.applyDeployment).toHaveBeenCalledWith(created);
    expect(set).toHaveBeenCalledTimes(1);

    // Only the deploy time is stored; the status is not a column any more.
    const persisted = firstArgument(set) as Record<string, unknown>;

    expect(Object.keys(persisted)).toEqual(['last_deployed_at']);
    expect(persisted.last_deployed_at).toBeInstanceOf(Date);
    expect(status.announce).toHaveBeenCalledWith(deployed);
    expect(result).toMatchObject({ id: workloadId, status: 'deploying' });
  });

  it('stops a Deployment and reports the cluster status without a write', async () => {
    const { service, limit, set, appsV1, status } = createService();
    const replaced = {
      metadata: { name: externalName },
      spec: { replicas: 0 },
    };

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(createDeployment());
    appsV1.replaceNamespacedDeployment.mockResolvedValue(replaced);
    status.announce.mockResolvedValue({
      status: 'stopped',
      status_message: null,
      status_observed_at: '2026-11-02T10:00:00.000Z',
    });

    const result = await service.stop(projectId, workloadId);

    const replace = firstArgument(appsV1.replaceNamespacedDeployment) as {
      name?: string;
      namespace?: string;
      body?: { spec?: { replicas?: number } };
    };

    expect(replace.name).toBe(externalName);
    expect(replace.namespace).toBe(namespace);
    expect(replace.body?.spec?.replicas).toBe(0);
    expect(status.applyDeployment).toHaveBeenCalledWith(replaced);
    expect(set).not.toHaveBeenCalled();
    expect(status.announce).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: workloadId, status: 'stopped' });
  });

  it('restarts a Deployment with a new deployment time', async () => {
    const { service, limit, set, returning, appsV1, status } = createService();
    const replaced = { metadata: { name: externalName, generation: 5 } };
    const restarted: WorkloadRow = {
      ...baseRow,
      last_deployed_at: new Date('2026-11-02T10:00:00.000Z'),
      updated_at: new Date('2026-11-02T10:00:01.000Z'),
    };
    const before = Date.now();

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(createDeployment());
    appsV1.replaceNamespacedDeployment.mockResolvedValue(replaced);
    returning.mockResolvedValue([restarted]);
    status.announce.mockResolvedValue(rolling);

    const result = await service.restart(projectId, workloadId);

    expect(appsV1.replaceNamespacedDeployment).toHaveBeenCalledTimes(1);
    expect(status.applyDeployment).toHaveBeenCalledWith(replaced);

    const persisted = firstArgument(set) as { last_deployed_at?: Date };

    expect(persisted.last_deployed_at?.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(result).toMatchObject({ id: workloadId, status: 'deploying' });
  });

  it('restarts a stopped Deployment at the active version replica count', async () => {
    const { service, limit, returning, appsV1, versions } = createService();

    versions.findByIds.mockResolvedValue(
      new Map([
        [
          activeVersionId,
          {
            ...activeVersion,
            config: { docker_image: 'nginx:1.25', replicas: 3 },
          },
        ],
      ]),
    );
    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue({
      ...createDeployment(),
      spec: { ...createDeployment().spec!, replicas: 0 },
    });
    appsV1.replaceNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([baseRow]);

    await service.restart(projectId, workloadId);

    const { body } = firstArgument(appsV1.replaceNamespacedDeployment) as {
      body: V1Deployment;
    };

    expect(body.spec?.replicas).toBe(3);
  });

  it('removes the Deployment, its env Secret and the row, then forgets its status', async () => {
    const { service, limit, deleteWhere, appsV1, coreV1, status, publish } =
      createService();

    limit.mockResolvedValue([baseRow]);
    appsV1.deleteNamespacedDeployment.mockResolvedValue({});
    coreV1.listNamespacedSecret.mockResolvedValue({
      items: [
        { metadata: { name: `${externalName}-env-a` } },
        { metadata: { name: `${externalName}-env-b` } },
        { metadata: { name: 'unrelated' } },
      ],
    });
    coreV1.deleteNamespacedSecret.mockResolvedValue({});
    deleteWhere.mockResolvedValue(undefined);

    await service.remove(projectId, workloadId);

    expect(appsV1.deleteNamespacedDeployment).toHaveBeenCalledWith({
      name: externalName,
      namespace,
    });
    expect(coreV1.listNamespacedSecret).toHaveBeenCalledWith({
      namespace,
      labelSelector: `acceleratio.io/workload-id=${workloadId}`,
    });
    expect(
      coreV1.deleteNamespacedSecret.mock.calls.map(([arg]: unknown[]) => arg),
    ).toEqual([
      { name: `${externalName}-env-a`, namespace },
      { name: `${externalName}-env-b`, namespace },
    ]);
    expect(status.forget).toHaveBeenCalledWith(workloadId);
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

  it('stores a resource-only change as a draft', async () => {
    const { service, limit, set, returning } = createService();
    const draft = { docker_image: 'nginx:1.25', cpu_max: 0.5, ram_max: 256 };

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([{ ...baseRow, draft_config: draft }]);

    await service.update(projectId, workloadId, {
      config: { ...draft, entrypoint: [], command: [] },
    });

    expect(set).toHaveBeenCalledWith({ draft_config: draft });
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

describe('DockerWorkloadService environment', () => {
  const env = [
    { key: 'FOO', value: 'bar' },
    { key: 'GREETING', value: 'hello world' },
  ];
  const deployedRow = (): WorkloadRow => ({
    ...baseRow,
    last_deployed_at: new Date('2026-11-02T10:00:00.000Z'),
  });

  it('creates the version Secret before the Deployment on deploy', async () => {
    const { service, limit, returning, appsV1, coreV1 } = createService();
    const order: string[] = [];

    limit.mockResolvedValue([
      { ...baseRow, draft_config: { docker_image: 'nginx:1.26', env } },
    ]);
    coreV1.createNamespacedSecret.mockImplementation(() => {
      order.push('secret');
      return Promise.resolve({});
    });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockImplementation(() => {
      order.push('deployment');
      return Promise.resolve({});
    });
    returning.mockResolvedValue([deployedRow()]);

    await service.deploy(projectId, workloadId);

    expect(order).toEqual(['secret', 'deployment']);

    const secret = firstArgument(coreV1.createNamespacedSecret) as {
      namespace: string;
      body: { metadata: { name: string }; immutable: boolean };
    };

    expect(secret).toMatchObject({
      namespace,
      body: {
        immutable: true,
        stringData: { FOO: 'bar', GREETING: 'hello world' },
      },
    });
    expect(secret.body.metadata.name).toMatch(
      new RegExp(`^${externalName}-env-[0-9a-f-]{36}$`),
    );

    const deployment = (
      firstArgument(appsV1.createNamespacedDeployment) as { body: V1Deployment }
    ).body;

    expect(deployment.spec?.template.spec?.containers[0].envFrom).toEqual([
      { secretRef: { name: secret.body.metadata.name } },
    ]);
    expect(coreV1.deleteNamespacedSecret).not.toHaveBeenCalled();
  });

  it('accepts a version Secret that already exists on a redeploy', async () => {
    const { service, limit, returning, appsV1, coreV1 } = createService();

    limit.mockResolvedValue([baseRow]);
    // The active version carries variables; redeploying it reuses its Secret.
    const mutable = activeVersion as { config: unknown };

    mutable.config = { docker_image: 'nginx:1.25', env };
    coreV1.createNamespacedSecret.mockRejectedValue({ code: 409 });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([deployedRow()]);

    try {
      await service.deploy(projectId, workloadId);
    } finally {
      mutable.config = { docker_image: 'nginx:1.25' };
    }

    expect(firstArgument(coreV1.createNamespacedSecret)).toMatchObject({
      body: { metadata: { name: `${externalName}-env-${activeVersionId}` } },
    });
    expect(appsV1.createNamespacedDeployment).toHaveBeenCalled();
  });

  it('keeps Secrets that pods still running may need, and prunes the rest', async () => {
    const { service, limit, returning, appsV1, coreV1 } = createService();
    const replicaSet = (
      secret: string,
      replicas: number,
      running = replicas,
    ) => ({
      spec: {
        replicas,
        template: {
          spec: {
            containers: [{ envFrom: [{ secretRef: { name: secret } }] }],
          },
        },
      },
      status: { replicas: running },
    });

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    appsV1.listNamespacedReplicaSet.mockResolvedValue({
      items: [
        replicaSet(`${externalName}-env-previous`, 1),
        replicaSet(`${externalName}-env-draining`, 0, 1),
        replicaSet(`${externalName}-env-old`, 0),
      ],
    });
    coreV1.listNamespacedSecret.mockResolvedValue({
      items: [
        { metadata: { name: `${externalName}-env-previous` } },
        { metadata: { name: `${externalName}-env-draining` } },
        { metadata: { name: `${externalName}-env-old` } },
        { metadata: { name: `${externalName}-env-orphan` } },
        { metadata: { name: 'other-secret' } },
      ],
    });
    coreV1.deleteNamespacedSecret.mockResolvedValue({});
    returning.mockResolvedValue([deployedRow()]);

    await service.deploy(projectId, workloadId);

    expect(
      coreV1.deleteNamespacedSecret.mock.calls.map(([arg]: unknown[]) => arg),
    ).toEqual([
      { name: `${externalName}-env-old`, namespace },
      { name: `${externalName}-env-orphan`, namespace },
    ]);
  });

  it('never deletes a Secret before the Deployment stops using it', async () => {
    const { service, limit, returning, appsV1, coreV1 } = createService();
    const order: string[] = [];

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockImplementation(() => {
      order.push('deployment');
      return Promise.resolve({});
    });
    coreV1.listNamespacedSecret.mockResolvedValue({
      items: [{ metadata: { name: `${externalName}-env-old` } }],
    });
    coreV1.deleteNamespacedSecret.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve({});
    });
    returning.mockResolvedValue([deployedRow()]);

    await service.deploy(projectId, workloadId);

    expect(order).toEqual(['deployment', 'delete']);
    expect(coreV1.createNamespacedSecret).not.toHaveBeenCalled();

    const deployment = (
      firstArgument(appsV1.createNamespacedDeployment) as { body: V1Deployment }
    ).body;

    expect(
      deployment.spec?.template.spec?.containers[0].envFrom,
    ).toBeUndefined();
  });

  it('does not fail a deploy when the cleanup fails', async () => {
    const { service, limit, returning, appsV1, coreV1 } = createService();

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    coreV1.listNamespacedSecret.mockRejectedValue(new Error('boom'));
    returning.mockResolvedValue([deployedRow()]);

    await expect(service.deploy(projectId, workloadId)).resolves.toBeDefined();
  });

  it('does not touch Secrets when the Deployment write fails', async () => {
    const { service, limit, appsV1, coreV1 } = createService();

    limit.mockResolvedValue([
      { ...baseRow, draft_config: { docker_image: 'nginx:1.26', env } },
    ]);
    coreV1.createNamespacedSecret.mockResolvedValue({});
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockRejectedValue({ code: 422 });

    await expect(service.deploy(projectId, workloadId)).rejects.toBeDefined();

    expect(coreV1.listNamespacedSecret).not.toHaveBeenCalled();
    expect(coreV1.deleteNamespacedSecret).not.toHaveBeenCalled();
  });

  it('writes the env of the version it rolls back to', async () => {
    const { service, limit, returning, appsV1, coreV1, versions } =
      createService();

    limit.mockResolvedValue([baseRow]);
    versions.get.mockResolvedValue({
      ...olderVersion,
      config: { docker_image: 'nginx:1.24', env: [{ key: 'OLD', value: '1' }] },
    });
    coreV1.createNamespacedSecret.mockResolvedValue({});
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([deployedRow()]);

    await service.rollback(projectId, workloadId, olderVersionId);

    expect(firstArgument(coreV1.createNamespacedSecret)).toMatchObject({
      body: { stringData: { OLD: '1' } },
    });
  });
});

describe('DockerWorkloadService environment values', () => {
  const activeEnv = [{ key: 'TOKEN', value: 'active-secret' }];
  const draftEnv = [{ key: 'TOKEN', value: 'draft-secret' }];
  const activeWithEnv: WorkloadVersionRow = {
    ...activeVersion,
    config: { docker_image: 'nginx:1.25', env: activeEnv },
  };
  const withActiveEnv = (
    harness: ReturnType<typeof createService>,
  ): ReturnType<typeof createService> => {
    harness.versions.findByIds.mockResolvedValue(
      new Map([[activeVersionId, activeWithEnv]]),
    );

    return harness;
  };

  it('never returns values in a workload, only the names', async () => {
    const { service, limit } = withActiveEnv(createService());

    limit.mockResolvedValue([
      {
        ...baseRow,
        draft_config: { docker_image: 'nginx:1.26', env: draftEnv },
      },
    ]);

    const result = await service.get(projectId, workloadId);

    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.draft_config).toEqual({
      docker_image: 'nginx:1.26',
      env_keys: ['TOKEN'],
    });
    expect(result.active_version?.config).toEqual({
      docker_image: 'nginx:1.25',
      env_keys: ['TOKEN'],
    });
  });

  it('never returns values in version history', async () => {
    const { service, limit, versions } = createService();

    limit.mockResolvedValue([baseRow]);
    versions.list.mockResolvedValue([activeWithEnv, olderVersion]);
    versions.get.mockResolvedValue(activeWithEnv);

    const list = await service.listVersions(projectId, workloadId);
    const one = await service.getVersion(
      projectId,
      workloadId,
      activeVersionId,
    );

    expect(JSON.stringify([list, one])).not.toContain('secret');
    expect(list[0].config).toEqual({
      docker_image: 'nginx:1.25',
      env_keys: ['TOKEN'],
    });
    expect(list[1].config).toEqual({ docker_image: 'nginx:1.24' });
  });

  it('returns the draft values first, then the active ones', async () => {
    const { service, limit } = withActiveEnv(createService());

    limit.mockResolvedValueOnce([
      {
        ...baseRow,
        draft_config: { docker_image: 'nginx:1.26', env: draftEnv },
      },
    ]);
    await expect(service.getEnv(projectId, workloadId)).resolves.toEqual({
      env: draftEnv,
    });

    limit.mockResolvedValueOnce([baseRow]);
    await expect(service.getEnv(projectId, workloadId)).resolves.toEqual({
      env: activeEnv,
    });

    limit.mockResolvedValueOnce([
      { ...baseRow, draft_config: { docker_image: 'nginx:1.26' } },
    ]);
    await expect(service.getEnv(projectId, workloadId)).resolves.toEqual({
      env: [],
    });
  });

  it('keeps the stored variables when an update leaves env out', async () => {
    const { service, limit, set, returning } = withActiveEnv(createService());

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: { docker_image: 'nginx:1.26' },
    });

    expect(set).toHaveBeenCalledWith({
      draft_config: { docker_image: 'nginx:1.26', env: activeEnv },
    });
  });

  it('keeps the draft variables over the active ones', async () => {
    const { service, limit, set, returning } = withActiveEnv(createService());

    limit.mockResolvedValue([
      {
        ...baseRow,
        draft_config: { docker_image: 'nginx:1.26', env: draftEnv },
      },
    ]);
    returning.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: { docker_image: 'nginx:1.27', env_keys: ['TOKEN'] },
    });

    expect(set).toHaveBeenCalledWith({
      draft_config: { docker_image: 'nginx:1.27', env: draftEnv },
    });
  });

  it('removes every variable when an update sends an empty list', async () => {
    const { service, limit, set, returning } = withActiveEnv(createService());

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: { docker_image: 'nginx:1.25', env: [] },
    });

    expect(set).toHaveBeenCalledWith({
      draft_config: { docker_image: 'nginx:1.25' },
    });
  });
});

describe('DockerWorkloadService volumes', () => {
  const volumeId = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
  const profileId = '8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a';
  const storedVolume = {
    id: volumeId,
    mount_path: '/data',
    size_gb: 10,
    storage_class_id: null,
  };
  const withVolumeDraft = (): WorkloadRow => ({
    ...baseRow,
    draft_config: { docker_image: 'nginx:1.25', volumes: [storedVolume] },
  });

  it('assigns an id to a new volume and checks its profile', async () => {
    const { service, limit, set, returning, storageClasses } = createService();

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: {
        docker_image: 'nginx:1.25',
        volumes: [
          { mount_path: '/data/', size_gb: 5, storage_class_id: profileId },
        ],
      },
    });

    const draft = (set.mock.calls[0] as [{ draft_config: unknown }])[0]
      .draft_config as { volumes: { id: string }[] };

    expect(draft.volumes).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
        mount_path: '/data',
        size_gb: 5,
        storage_class_id: profileId,
      },
    ]);
    expect(storageClasses.assertVolumeProfile).toHaveBeenCalledWith(profileId);
  });

  it('lets a known volume change its mount path', async () => {
    const { service, limit, set, returning } = createService();

    limit.mockResolvedValue([withVolumeDraft()]);
    returning.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: {
        docker_image: 'nginx:1.25',
        volumes: [{ ...storedVolume, mount_path: '/var/lib/data' }],
      },
    });

    expect(set).toHaveBeenCalledWith({
      draft_config: {
        docker_image: 'nginx:1.25',
        volumes: [{ ...storedVolume, mount_path: '/var/lib/data' }],
      },
    });
  });

  it('rejects a size or profile change of a known volume', async () => {
    const { service, limit } = createService();

    limit.mockResolvedValue([withVolumeDraft()]);

    await expect(
      service.update(projectId, workloadId, {
        config: {
          docker_image: 'nginx:1.25',
          volumes: [{ ...storedVolume, size_gb: 20 }],
        },
      }),
    ).rejects.toThrow('cannot change');
    await expect(
      service.update(projectId, workloadId, {
        config: {
          docker_image: 'nginx:1.25',
          volumes: [{ ...storedVolume, storage_class_id: profileId }],
        },
      }),
    ).rejects.toThrow('cannot change');
  });

  it('rejects an id the service never had', async () => {
    const { service, limit } = createService();

    limit.mockResolvedValue([baseRow]);

    await expect(
      service.update(projectId, workloadId, {
        config: { docker_image: 'nginx:1.25', volumes: [storedVolume] },
      }),
    ).rejects.toThrow('Unknown volume');
  });

  it('creates claims before the Deployment and mounts them', async () => {
    const { service, limit, returning, appsV1, coreV1 } = createService();
    const order: string[] = [];

    limit.mockResolvedValue([withVolumeDraft()]);
    coreV1.createNamespacedPersistentVolumeClaim.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve({});
    });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockImplementation(() => {
      order.push('deployment');
      return Promise.resolve({});
    });
    returning.mockResolvedValue([baseRow]);

    await service.deploy(projectId, workloadId);

    expect(order).toEqual(['claim', 'deployment']);
    expect(
      firstArgument(coreV1.createNamespacedPersistentVolumeClaim),
    ).toMatchObject({
      namespace,
      body: {
        metadata: {
          name: `${externalName}-vol-7c8d9e0f1a2b4c3d8e4f5a6b7c8d9e0f`,
        },
        spec: {
          storageClassName: 'seaweedfs-storage',
          resources: { requests: { storage: '10Gi' } },
        },
      },
    });

    const deployment = (
      firstArgument(appsV1.createNamespacedDeployment) as { body: V1Deployment }
    ).body;

    expect(deployment.spec?.template.spec?.volumes).toEqual([
      {
        name: 'vol-7c8d9e0f1a2b4c3d8e4f5a6b7c8d9e0f',
        persistentVolumeClaim: {
          claimName: `${externalName}-vol-7c8d9e0f1a2b4c3d8e4f5a6b7c8d9e0f`,
        },
      },
    ]);
    expect(deployment.spec?.template.spec?.containers[0].volumeMounts).toEqual([
      { name: 'vol-7c8d9e0f1a2b4c3d8e4f5a6b7c8d9e0f', mountPath: '/data' },
    ]);
  });

  it('accepts a claim that already exists', async () => {
    const { service, limit, returning, appsV1, coreV1 } = createService();

    limit.mockResolvedValue([withVolumeDraft()]);
    coreV1.createNamespacedPersistentVolumeClaim.mockRejectedValue({
      code: 409,
    });
    coreV1.readNamespacedPersistentVolumeClaim.mockResolvedValue({
      metadata: { labels: { 'acceleratio.io/volume-id': volumeId } },
    });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([baseRow]);

    await expect(service.deploy(projectId, workloadId)).resolves.toBeDefined();
  });

  it('deletes claims of volumes the deployed config dropped', async () => {
    const { service, limit, returning, appsV1, coreV1 } = createService();

    limit.mockResolvedValue([withVolumeDraft()]);
    coreV1.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      items: [
        {
          metadata: {
            name: `${externalName}-vol-7c8d9e0f1a2b4c3d8e4f5a6b7c8d9e0f`,
            labels: { 'acceleratio.io/volume-id': volumeId },
          },
        },
        {
          metadata: {
            name: `${externalName}-vol-dropped`,
            labels: { 'acceleratio.io/volume-id': 'dropped' },
          },
        },
      ],
    });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([baseRow]);

    await service.deploy(projectId, workloadId);

    expect(coreV1.listNamespacedPersistentVolumeClaim).toHaveBeenCalledWith({
      namespace,
      labelSelector: `acceleratio.io/workload-id=${workloadId}`,
    });
    expect(
      coreV1.deleteNamespacedPersistentVolumeClaim.mock.calls.map(
        ([arg]: unknown[]) => arg,
      ),
    ).toEqual([{ name: `${externalName}-vol-dropped`, namespace }]);
  });

  it('deletes every claim with the service', async () => {
    const { service, limit, deleteWhere, appsV1, coreV1 } = createService();

    limit.mockResolvedValue([baseRow]);
    appsV1.deleteNamespacedDeployment.mockResolvedValue({});
    coreV1.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      items: [
        {
          metadata: {
            name: `${externalName}-vol-7c8d9e0f1a2b4c3d8e4f5a6b7c8d9e0f`,
            labels: { 'acceleratio.io/volume-id': volumeId },
          },
        },
      ],
    });
    deleteWhere.mockResolvedValue(undefined);

    await service.remove(projectId, workloadId);

    expect(coreV1.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalledWith({
      name: `${externalName}-vol-7c8d9e0f1a2b4c3d8e4f5a6b7c8d9e0f`,
      namespace,
    });
  });
});

describe('DockerWorkloadService volume safety', () => {
  const volumeId = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
  const claimName = `${externalName}-vol-7c8d9e0f1a2b4c3d8e4f5a6b7c8d9e0f`;
  const storedVolume = {
    id: volumeId,
    mount_path: '/data',
    size_gb: 10,
    storage_class_id: null,
  };
  const withActiveVolume = (service: ReturnType<typeof createService>) => {
    service.versions.findByIds.mockResolvedValue(
      new Map([
        [
          activeVersionId,
          {
            ...activeVersion,
            config: { docker_image: 'nginx:1.25', volumes: [storedVolume] },
          },
        ],
      ]),
    );

    return service;
  };
  const claim = (name: string, id: string, deleting = false) => ({
    metadata: {
      name,
      labels: { 'acceleratio.io/volume-id': id },
      ...(deleting ? { deletionTimestamp: new Date() } : {}),
    },
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the stored volumes when an update leaves volumes out', async () => {
    const { service, limit, set, returning } =
      withActiveVolume(createService());

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: { docker_image: 'nginx:1.26' },
    });

    expect(set).toHaveBeenCalledWith({
      draft_config: { docker_image: 'nginx:1.26', volumes: [storedVolume] },
    });
  });

  it('removes every volume only when an update sends an empty list', async () => {
    const { service, limit, set, returning } =
      withActiveVolume(createService());

    limit.mockResolvedValue([baseRow]);
    returning.mockResolvedValue([baseRow]);

    await service.update(projectId, workloadId, {
      config: { docker_image: 'nginx:1.25', volumes: [] },
    });

    expect(set).toHaveBeenCalledWith({
      draft_config: { docker_image: 'nginx:1.25' },
    });
  });

  it('rolls back the rest of the config but keeps the current volumes', async () => {
    const { service, limit, returning, appsV1, coreV1, versions } =
      withActiveVolume(createService());

    versions.get.mockResolvedValue({
      ...olderVersion,
      config: {
        docker_image: 'nginx:1.24',
        volumes: [
          { ...storedVolume, id: 'a1b2c3d4-0000-4000-8000-000000000000' },
        ],
      },
    });
    limit.mockResolvedValue([baseRow]);
    coreV1.createNamespacedPersistentVolumeClaim.mockResolvedValue({});
    coreV1.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      items: [claim(claimName, volumeId)],
    });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([baseRow]);

    await service.rollback(projectId, workloadId, olderVersionId);

    expect(versions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { docker_image: 'nginx:1.24', volumes: [storedVolume] },
      }),
    );
    expect(coreV1.deleteNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
  });

  it('rolls back to a version without volumes and still keeps them', async () => {
    const { service, limit, returning, appsV1, coreV1, versions } =
      withActiveVolume(createService());

    versions.get.mockResolvedValue(olderVersion);
    limit.mockResolvedValue([baseRow]);
    coreV1.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      items: [claim(claimName, volumeId)],
    });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([baseRow]);

    await service.rollback(projectId, workloadId, olderVersionId);

    const deployment = (
      firstArgument(appsV1.createNamespacedDeployment) as { body: V1Deployment }
    ).body;

    expect(deployment.spec?.template.spec?.containers[0].volumeMounts).toEqual([
      { name: `vol-${volumeId.replace(/-/g, '')}`, mountPath: '/data' },
    ]);
    expect(coreV1.deleteNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
  });

  it('refuses to reuse a claim that is being deleted', async () => {
    const { service, limit, appsV1, coreV1 } = createService();

    limit.mockResolvedValue([
      {
        ...baseRow,
        draft_config: { docker_image: 'nginx:1.25', volumes: [storedVolume] },
      },
    ]);
    coreV1.createNamespacedPersistentVolumeClaim.mockRejectedValue({
      code: 409,
    });
    coreV1.readNamespacedPersistentVolumeClaim.mockResolvedValue(
      claim(claimName, volumeId, true),
    );

    await expect(service.deploy(projectId, workloadId)).rejects.toThrow(
      'still being deleted',
    );
    expect(appsV1.createNamespacedDeployment).not.toHaveBeenCalled();
  });

  it('refuses a claim of the same name that is not this volume', async () => {
    const { service, limit, coreV1 } = createService();

    limit.mockResolvedValue([
      {
        ...baseRow,
        draft_config: { docker_image: 'nginx:1.25', volumes: [storedVolume] },
      },
    ]);
    coreV1.createNamespacedPersistentVolumeClaim.mockRejectedValue({
      code: 409,
    });
    coreV1.readNamespacedPersistentVolumeClaim.mockResolvedValue(
      claim(claimName, 'someone-else'),
    );

    await expect(service.deploy(projectId, workloadId)).rejects.toThrow(
      'belongs to something else',
    );
  });

  it('keeps a dropped claim while old pods mount it, then deletes it', async () => {
    jest.useFakeTimers();
    const service = withActiveVolume(createService());
    const { limit, returning, appsV1, coreV1 } = service;
    const draftRow = {
      ...baseRow,
      draft_config: { docker_image: 'nginx:1.25' },
    };
    const oldReplicaSet = {
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [],
            volumes: [{ name: 'v', persistentVolumeClaim: { claimName } }],
          },
        },
      },
      status: { replicas: 1 },
    };

    limit.mockResolvedValue([draftRow]);
    coreV1.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      items: [claim(claimName, volumeId)],
    });
    appsV1.listNamespacedReplicaSet.mockResolvedValue({
      items: [oldReplicaSet],
    });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([baseRow]);

    await service.service.deploy(projectId, workloadId);

    expect(coreV1.deleteNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();

    // The rollout finished: the old ReplicaSet has no pods, and the version
    // just recorded is active.
    const recorded = (
      service.versions.record.mock.calls[0] as [{ id: string }]
    )[0].id;

    appsV1.listNamespacedReplicaSet.mockResolvedValue({ items: [] });
    limit.mockResolvedValue([{ active_version_id: recorded }]);

    await jest.advanceTimersByTimeAsync(10_000);

    expect(coreV1.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalledWith({
      name: claimName,
      namespace,
    });
  });

  it('stops retrying once another version is active', async () => {
    jest.useFakeTimers();
    const service = withActiveVolume(createService());
    const { limit, returning, appsV1, coreV1 } = service;

    limit.mockResolvedValue([
      { ...baseRow, draft_config: { docker_image: 'nginx:1.25' } },
    ]);
    coreV1.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      items: [claim(claimName, volumeId)],
    });
    appsV1.listNamespacedReplicaSet.mockResolvedValue({
      items: [
        {
          spec: {
            replicas: 1,
            template: {
              spec: {
                containers: [],
                volumes: [{ name: 'v', persistentVolumeClaim: { claimName } }],
              },
            },
          },
        },
      ],
    });
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([baseRow]);

    await service.service.deploy(projectId, workloadId);

    appsV1.listNamespacedReplicaSet.mockResolvedValue({ items: [] });
    limit.mockResolvedValue([{ active_version_id: 'another-version' }]);
    coreV1.listNamespacedPersistentVolumeClaim.mockClear();

    await jest.advanceTimersByTimeAsync(10_000);

    expect(coreV1.listNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
    expect(coreV1.deleteNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
  });

  it('runs two deploys of one service one after another', async () => {
    const { service, limit, returning, appsV1 } = createService();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    limit.mockResolvedValue([baseRow]);
    appsV1.readNamespacedDeployment.mockResolvedValue({
      ...createDeployment(),
      metadata: { name: externalName, resourceVersion: '1' },
    });
    appsV1.replaceNamespacedDeployment
      .mockImplementationOnce(async () => {
        events.push('first:start');
        await gate;
        events.push('first:end');
        return {};
      })
      .mockImplementationOnce(() => {
        events.push('second');
        return Promise.resolve({});
      });
    returning.mockResolvedValue([baseRow]);

    const first = service.deploy(projectId, workloadId);
    const second = service.deploy(projectId, workloadId);

    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([first, second]);

    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });
});

describe('DockerWorkloadService volume sweep', () => {
  const keptId = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
  const draftId = '8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a';
  const orphanId = '9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b';
  const unknownWorkload = '0f1a2b3c-4d5e-4f6a-8b7c-8d9e0f1a2b3c';
  const claim = (volumeId: string, workload = workloadId) => ({
    metadata: {
      name: `claim-${volumeId}`,
      namespace,
      labels: {
        'acceleratio.io/workload-id': workload,
        'acceleratio.io/volume-id': volumeId,
      },
    },
  });

  it('deletes only claims of known services that no config lists', async () => {
    const { service, selectWhere, limit, coreV1, versions } = createService();
    const volume = (id: string) => ({
      id,
      mount_path: `/${id.slice(0, 4)}`,
      size_gb: 1,
      storage_class_id: null,
    });
    const row = {
      ...baseRow,
      draft_config: { docker_image: 'nginx:1.25', volumes: [volume(draftId)] },
    };

    versions.findByIds.mockResolvedValue(
      new Map([
        [
          activeVersionId,
          {
            ...activeVersion,
            config: { docker_image: 'nginx:1.25', volumes: [volume(keptId)] },
          },
        ],
      ]),
    );
    coreV1.listPersistentVolumeClaimForAllNamespaces.mockResolvedValue({
      items: [
        claim(keptId),
        claim(draftId),
        claim(orphanId),
        claim(orphanId, unknownWorkload),
      ],
    });
    // The batch lookup resolves from `where`; the per-row read uses `limit`.
    selectWhere.mockImplementationOnce(() =>
      Object.assign(Promise.resolve([row]), { limit }),
    );
    limit.mockResolvedValue([row]);
    coreV1.listNamespacedPersistentVolumeClaim.mockResolvedValue({
      items: [claim(keptId), claim(draftId), claim(orphanId)],
    });

    await service.sweepVolumeClaims();

    expect(
      coreV1.listPersistentVolumeClaimForAllNamespaces,
    ).toHaveBeenCalledWith({
      labelSelector:
        'app.kubernetes.io/managed-by=acceleratio,acceleratio.io/volume-id',
    });
    expect(
      coreV1.deleteNamespacedPersistentVolumeClaim.mock.calls.map(
        ([arg]: unknown[]) => arg,
      ),
    ).toEqual([{ name: `claim-${orphanId}`, namespace }]);
  });

  it('does nothing without managed claims', async () => {
    const { service, select, coreV1 } = createService();

    await service.sweepVolumeClaims();

    expect(select).not.toHaveBeenCalled();
    expect(coreV1.deleteNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
  });
});

describe('DockerWorkloadService version comparison', () => {
  const volume = {
    id: '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    mount_path: '/data',
    size_gb: 10,
    storage_class_id: null,
  };
  const author = { id: 'user-1', name: 'Ada', email: 'ada@example.com' };

  it('compares the resolved sides and keeps variable values on the server', async () => {
    const { service, limit, versions } = createService();
    const withDraft: WorkloadRow = {
      ...baseRow,
      draft_config: {
        docker_image: 'nginx:1.26',
        env: [{ key: 'TOKEN', value: 'new-token-value' }],
      },
    };

    limit.mockResolvedValue([withDraft]);
    versions.resolveSide.mockImplementation((_row, ref: string) =>
      Promise.resolve(
        ref === 'draft'
          ? { side: { kind: 'draft' }, config: withDraft.draft_config }
          : {
              side: {
                kind: 'version',
                version_id: activeVersionId,
                number: 2,
              },
              config: {
                docker_image: 'nginx:1.25',
                env: [{ key: 'TOKEN', value: 'old-token-value' }],
              },
            },
      ),
    );

    const diff = await service.diffVersions(
      projectId,
      workloadId,
      'active',
      'draft',
    );

    expect(versions.resolveSide).toHaveBeenCalledWith(withDraft, 'active');
    expect(versions.resolveSide).toHaveBeenCalledWith(withDraft, 'draft');
    expect(diff).toMatchObject({
      workload_id: workloadId,
      type: 'docker',
      base: { kind: 'version', number: 2 },
      target: { kind: 'draft' },
      identical: false,
      restarts: true,
    });
    expect(diff.sections.map((section) => section.key)).toEqual([
      'image',
      'environment',
    ]);
    expect(JSON.stringify(diff)).not.toContain('token-value');
  });

  it('previews a rollback with the volumes the service has now', async () => {
    const { service, limit, versions } = createService();
    const active: WorkloadVersionRow = {
      ...activeVersion,
      config: { docker_image: 'nginx:1.25', volumes: [volume] },
    };

    limit.mockResolvedValue([baseRow]);
    versions.get.mockResolvedValue(olderVersion);
    versions.findByIds.mockResolvedValue(new Map([[active.id, active]]));

    const diff = await service.previewRollback(
      projectId,
      workloadId,
      olderVersionId,
    );

    expect(diff.base).toEqual({
      kind: 'version',
      version_id: activeVersionId,
      number: 2,
    });
    expect(diff.target).toEqual({
      kind: 'version',
      version_id: olderVersionId,
      number: 1,
    });
    // v1 had no volumes, but the rollback keeps /data: no data loss.
    expect(diff.sections.map((section) => section.key)).toEqual(['image']);
    expect(diff.data_loss).toBe(false);
    expect(diff.notes).toEqual([
      'v1 had different volumes. A rollback keeps the volumes the service has now and their data.',
    ]);
  });

  it('refuses to preview a rollback to the active version', async () => {
    const { service, limit, versions } = createService();

    limit.mockResolvedValue([baseRow]);
    versions.get.mockResolvedValue(activeVersion);

    await expect(
      service.previewRollback(projectId, workloadId, activeVersionId),
    ).rejects.toThrow('Version is already active');
  });

  it('records the author of a deploy and of a rollback', async () => {
    const { service, limit, returning, appsV1, versions } = createService();

    limit.mockResolvedValue([
      { ...baseRow, draft_config: { docker_image: 'nginx:1.26' } },
    ]);
    appsV1.readNamespacedDeployment.mockResolvedValue(undefined);
    appsV1.createNamespacedDeployment.mockResolvedValue({});
    returning.mockResolvedValue([baseRow]);

    await service.deploy(projectId, workloadId, author);

    expect(firstArgument(versions.record)).toMatchObject({ author });

    versions.record.mockClear();
    limit.mockResolvedValue([baseRow]);
    versions.get.mockResolvedValue(olderVersion);

    await service.rollback(projectId, workloadId, olderVersionId, author);

    expect(firstArgument(versions.record)).toMatchObject({
      author,
      sourceVersionId: olderVersionId,
    });
  });
});
