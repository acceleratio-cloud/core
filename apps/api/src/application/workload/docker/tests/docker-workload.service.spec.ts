import { Logger } from '@nestjs/common';
import type {
  V1Deployment,
  V1DeploymentCondition,
  V1Pod,
} from '@kubernetes/client-node';
import type { WorkloadType } from '@acceleratio/shared';
import type { ProjectIsolationService } from '@/application/project/project-isolation.service';
import type { ProjectService } from '@/application/project/project.service';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadRow } from '../../schemas/workload.schema';
import { DockerWorkloadService } from '../docker-workload.service';

// @kubernetes/client-node is ESM-only and Jest runs CommonJS. None of these
// collaborators is exercised here; only the classes are needed to construct
// the service.
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
  last_deployed_at: new Date('2026-11-01T10:00:00.000Z'),
  created_at: new Date('2026-11-01T09:00:00.000Z'),
  updated_at: new Date('2026-11-01T09:30:00.000Z'),
};

const createDeployment = (
  conditions: V1DeploymentCondition[],
): V1Deployment => ({
  metadata: { name: externalName },
  spec: {
    replicas: 1,
    selector: { matchLabels: {} },
    template: {},
  },
  status: { conditions },
});

const createPod = (reason: string): V1Pod => ({
  metadata: { labels: { 'acceleratio.io/workload-id': workloadId } },
  status: {
    containerStatuses: [
      {
        name: 'main',
        image: 'nginx:1.25',
        imageID: '',
        ready: false,
        restartCount: 0,
        state: { waiting: { reason } },
      },
    ],
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

  return {
    db: { select, update } as unknown as Database,
    select,
    selectWhere,
    orderBy,
    limit,
    update,
    set,
    returning,
  };
};

const createService = () => {
  const database = createDatabase();
  const appsV1 = { listNamespacedDeployment: jest.fn() };
  const coreV1 = { listNamespacedPod: jest.fn() };
  const kubernetes = { appsV1, coreV1 } as unknown as KubernetesService;
  const exists = jest.fn();
  const projectService = { exists } as unknown as ProjectService;
  const isolation = {
    ensure: jest.fn(),
    remove: jest.fn(),
  } as unknown as ProjectIsolationService;
  const service = new DockerWorkloadService(
    database.db,
    projectService,
    isolation,
    kubernetes,
  );

  return { service, ...database, appsV1, coreV1, exists };
};

describe('DockerWorkloadService.list reconciliation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns stored rows without a write when the cluster is unavailable', async () => {
    const { service, orderBy, update, appsV1, coreV1 } = createService();
    const stored: WorkloadRow = {
      ...baseRow,
      status: 'failed',
      status_message: 'previous failure',
    };

    orderBy.mockResolvedValue([stored]);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    appsV1.listNamespacedDeployment.mockRejectedValue(
      new Error('cluster unavailable'),
    );
    coreV1.listNamespacedPod.mockResolvedValue({ items: [] });

    const result = await service.list(projectId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: workloadId,
      status: 'failed',
      status_message: 'previous failure',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('strips a legacy port from the config returned to the API', async () => {
    const { service, orderBy, update, appsV1, coreV1 } = createService();
    const legacyRow = {
      ...baseRow,
      config: { docker_image: 'nginx:1.25', port: 8080 },
    } as WorkloadRow;

    orderBy.mockResolvedValue([legacyRow]);
    appsV1.listNamespacedDeployment.mockResolvedValue({ items: [] });
    coreV1.listNamespacedPod.mockResolvedValue({ items: [] });

    const result = await service.list(projectId);

    expect(result).toHaveLength(1);
    expect(result[0].config).toEqual({ docker_image: 'nginx:1.25' });
    expect(result[0].config).not.toHaveProperty('port');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not write when the observed status already matches the row', async () => {
    const { service, orderBy, update, appsV1, coreV1 } = createService();

    orderBy.mockResolvedValue([baseRow]);
    appsV1.listNamespacedDeployment.mockResolvedValue({
      items: [createDeployment([{ type: 'Available', status: 'True' }])],
    });
    coreV1.listNamespacedPod.mockResolvedValue({ items: [] });

    const result = await service.list(projectId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: workloadId,
      status: 'running',
      status_message: null,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('persists deploying to running when a replica is available', async () => {
    const { service, orderBy, update, set, returning, appsV1, coreV1 } =
      createService();
    const deploying: WorkloadRow = {
      ...baseRow,
      status: 'deploying',
      status_message: null,
    };
    const updated: WorkloadRow = { ...deploying, status: 'running' };

    orderBy.mockResolvedValue([deploying]);
    returning.mockResolvedValue([updated]);
    appsV1.listNamespacedDeployment.mockResolvedValue({
      items: [createDeployment([{ type: 'Available', status: 'True' }])],
    });
    coreV1.listNamespacedPod.mockResolvedValue({
      items: [createPod('ContainerCreating')],
    });

    const result = await service.list(projectId);

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      status: 'running',
      status_message: null,
    });
    expect(result[0]).toMatchObject({
      id: workloadId,
      status: 'running',
      status_message: null,
    });
  });

  it('persists failed with the image pull reason when no replica is available', async () => {
    const { service, orderBy, update, set, returning, appsV1, coreV1 } =
      createService();
    const deploying: WorkloadRow = {
      ...baseRow,
      status: 'deploying',
      status_message: null,
    };
    const failed: WorkloadRow = {
      ...deploying,
      status: 'failed',
      status_message: 'ImagePullBackOff',
    };

    orderBy.mockResolvedValue([deploying]);
    returning.mockResolvedValue([failed]);
    appsV1.listNamespacedDeployment.mockResolvedValue({
      items: [createDeployment([{ type: 'Available', status: 'False' }])],
    });
    coreV1.listNamespacedPod.mockResolvedValue({
      items: [createPod('ImagePullBackOff')],
    });

    const result = await service.list(projectId);

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      status: 'failed',
      status_message: 'ImagePullBackOff',
    });
    expect(result[0].status).toBe('failed');
    expect(result[0].status_message).toContain('ImagePullBackOff');
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
      namespace: `project-${projectId}`,
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
