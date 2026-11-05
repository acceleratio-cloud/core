import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadType,
} from '@acceleratio/shared';
import type { ProjectService } from '@/application/project/project.service';
import type { DockerWorkloadService } from '../docker/docker-workload.service';
import type { S3BucketWorkloadService } from '../s3-bucket/s3-bucket.service';
import type { WorkloadTypeRegistry } from '../workload-type.registry';
import type { WorkloadTypeResolver } from '../workload-type.resolver';
import { WorkloadService } from '../workload.service';

// The registry imports the real Docker service, and the project service pulls
// the ESM-only Kubernetes client. The facade only needs these class references
// to construct it.
jest.mock('../workload-type.registry', () => ({
  WorkloadTypeRegistry: class WorkloadTypeRegistry {},
}));
jest.mock('../workload-type.resolver', () => ({
  WorkloadTypeResolver: class WorkloadTypeResolver {},
}));
jest.mock('../docker/docker-workload.service', () => ({
  DockerWorkloadService: class DockerWorkloadService {},
}));
jest.mock('../s3-bucket/s3-bucket.service', () => ({
  S3BucketWorkloadService: class S3BucketWorkloadService {},
}));
jest.mock('@/application/project/project.service', () => ({
  ProjectService: class ProjectService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
// Stand-in for a type added after this refactor; the facade must not care.
const futureType = 'future' as WorkloadType;

const createWorkload = (overrides: Partial<Workload> = {}): Workload => ({
  id: workloadId,
  project_id: projectId,
  name: 'My API',
  type: 'docker',
  active_version: null,
  draft_config: { docker_image: 'nginx:1.25' },
  position: { x: 0, y: 0 },
  status: 'running',
  status_message: null,
  status_observed_at: null,
  external_name: 'my-api-3f9a1b2c',
  namespace: `project-${projectId}`,
  last_deployed_at: null,
  created_at: '2026-11-01T09:00:00.000Z',
  updated_at: '2026-11-01T09:30:00.000Z',
  ...overrides,
});

const createTypeService = (type: WorkloadType) => ({
  type,
  list: jest.fn(),
  create: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  deploy: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  restart: jest.fn(),
  remove: jest.fn(),
  rollback: jest.fn(),
  listVersions: jest.fn(),
  getVersion: jest.fn(),
  discardDraft: jest.fn(),
});

type FakeTypeService = ReturnType<typeof createTypeService>;
type RegistryFake = ReturnType<typeof createRegistry>;
type ResolverFake = { resolve: jest.Mock };
type ProjectServiceFake = { exists: jest.Mock };

const createProjectService = (exists = true): ProjectServiceFake => ({
  exists: jest.fn().mockResolvedValue(exists),
});

const createRegistry = (services: FakeTypeService[]) => ({
  all: jest.fn(() => services),
  get: jest.fn((type: WorkloadType) => {
    const service = services.find((candidate) => candidate.type === type);

    if (service === undefined) {
      throw new BadRequestException('Unsupported workload type');
    }

    return service;
  }),
});

const createResolver = (type: WorkloadType): ResolverFake => ({
  resolve: jest.fn().mockResolvedValue(type),
});

const createService = (
  registry: RegistryFake,
  resolver: ResolverFake,
  projectService: ProjectServiceFake = createProjectService(),
  s3Buckets: { type: 's3_bucket'; credentials: jest.Mock } = {
    type: 's3_bucket',
    credentials: jest.fn(),
  },
  docker: { type: 'docker'; getEnv: jest.Mock } = {
    type: 'docker',
    getEnv: jest.fn(),
  },
): WorkloadService =>
  new WorkloadService(
    registry as unknown as WorkloadTypeRegistry,
    resolver as unknown as WorkloadTypeResolver,
    projectService as unknown as ProjectService,
    s3Buckets as unknown as S3BucketWorkloadService,
    docker as unknown as DockerWorkloadService,
  );

describe('WorkloadService.list', () => {
  it('merges every type list and sorts by created_at with an id tie-breaker', async () => {
    const docker = createTypeService('docker');
    const future = createTypeService(futureType);
    const service = createService(
      createRegistry([docker, future]),
      createResolver('docker'),
    );
    const first = createWorkload({
      id: 'b',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    const second = createWorkload({
      id: 'a',
      created_at: '2026-11-01T09:00:00.000Z',
    });
    const third = createWorkload({
      id: 'c',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    const fourth = createWorkload({
      id: '0',
      created_at: '2026-11-01T08:00:00.000Z',
    });

    docker.list.mockResolvedValue([first, second]);
    future.list.mockResolvedValue([third, fourth]);

    await expect(service.list(projectId)).resolves.toEqual([
      fourth,
      second,
      first,
      third,
    ]);
    expect(docker.list).toHaveBeenCalledWith(projectId);
    expect(future.list).toHaveBeenCalledWith(projectId);
  });

  it('returns an empty list when no type has rows', async () => {
    const docker = createTypeService('docker');
    const service = createService(
      createRegistry([docker]),
      createResolver('docker'),
    );

    docker.list.mockResolvedValue([]);

    await expect(service.list(projectId)).resolves.toEqual([]);
  });
});

describe('WorkloadService.create', () => {
  it('dispatches by the payload type without resolving a row', async () => {
    const docker = createTypeService('docker');
    const future = createTypeService(futureType);
    const registry = createRegistry([docker, future]);
    const resolver = createResolver('docker');
    const service = createService(registry, resolver);
    const created = createWorkload({ type: futureType });
    const payload: CreateWorkloadPayload = {
      name: 'Worker',
      type: futureType,
      config: { docker_image: 'nginx:1.25' },
    };

    future.create.mockResolvedValue(created);

    await expect(service.create(projectId, payload)).resolves.toBe(created);
    expect(future.create).toHaveBeenCalledWith(projectId, payload);
    expect(docker.create).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown type when the project does not exist', async () => {
    const docker = createTypeService('docker');
    const registry = createRegistry([docker]);
    const projectService = createProjectService(false);
    const service = createService(
      registry,
      createResolver('docker'),
      projectService,
    );
    const payload: CreateWorkloadPayload = {
      name: 'Worker',
      type: futureType,
      config: { docker_image: 'nginx:1.25' },
    };

    await expect(service.create(projectId, payload)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.create(projectId, payload)).rejects.toThrow(
      'Project not found',
    );
    expect(projectService.exists).toHaveBeenCalledWith(projectId);
    expect(registry.get).not.toHaveBeenCalled();
    expect(docker.create).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown type when the project exists', async () => {
    const docker = createTypeService('docker');
    const registry = createRegistry([docker]);
    const projectService = createProjectService(true);
    const service = createService(
      registry,
      createResolver('docker'),
      projectService,
    );
    const payload: CreateWorkloadPayload = {
      name: 'Worker',
      type: futureType,
      config: { docker_image: 'nginx:1.25' },
    };

    await expect(service.create(projectId, payload)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(registry.get).toHaveBeenCalledWith(futureType);
    expect(docker.create).not.toHaveBeenCalled();
  });

  it('returns 404 for a valid docker payload when the project does not exist', async () => {
    const docker = createTypeService('docker');
    const registry = createRegistry([docker]);
    const projectService = createProjectService(false);
    const service = createService(
      registry,
      createResolver('docker'),
      projectService,
    );
    const payload: CreateWorkloadPayload = {
      name: 'My API',
      type: 'docker',
      config: { docker_image: 'nginx:1.25' },
    };

    await expect(service.create(projectId, payload)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.create(projectId, payload)).rejects.toThrow(
      'Project not found',
    );
    expect(registry.get).not.toHaveBeenCalled();
    expect(docker.create).not.toHaveBeenCalled();
  });
});

describe('WorkloadService row operations', () => {
  const updatePayload: UpdateWorkloadPayload = { name: 'Renamed' };

  const operations: Array<{
    method:
      'get' | 'update' | 'deploy' | 'start' | 'stop' | 'restart' | 'remove';
    args: unknown[];
    call: (service: WorkloadService) => Promise<unknown>;
  }> = [
    {
      method: 'get',
      args: [projectId, workloadId],
      call: (service) => service.get(projectId, workloadId),
    },
    {
      method: 'update',
      args: [projectId, workloadId, updatePayload],
      call: (service) => service.update(projectId, workloadId, updatePayload),
    },
    {
      method: 'deploy',
      args: [projectId, workloadId],
      call: (service) => service.deploy(projectId, workloadId),
    },
    {
      method: 'start',
      args: [projectId, workloadId],
      call: (service) => service.start(projectId, workloadId),
    },
    {
      method: 'stop',
      args: [projectId, workloadId],
      call: (service) => service.stop(projectId, workloadId),
    },
    {
      method: 'restart',
      args: [projectId, workloadId],
      call: (service) => service.restart(projectId, workloadId),
    },
    {
      method: 'remove',
      args: [projectId, workloadId],
      call: (service) => service.remove(projectId, workloadId),
    },
  ];

  it.each(operations)(
    'resolves the row type and delegates $method',
    async ({ method, args, call }) => {
      const docker = createTypeService('docker');
      const future = createTypeService(futureType);
      const registry = createRegistry([docker, future]);
      const resolver = createResolver('docker');
      const service = createService(registry, resolver);

      docker[method].mockResolvedValue(
        method === 'remove' ? undefined : createWorkload(),
      );

      await call(service);

      expect(resolver.resolve).toHaveBeenCalledWith(projectId, workloadId);
      expect(registry.get).toHaveBeenCalledWith('docker');
      expect(docker[method]).toHaveBeenCalledWith(...args);
      expect(future[method]).not.toHaveBeenCalled();
    },
  );

  it('dispatches to the service of the resolved row type', async () => {
    const docker = createTypeService('docker');
    const future = createTypeService(futureType);
    const service = createService(
      createRegistry([docker, future]),
      createResolver(futureType),
    );
    const found = createWorkload({ type: futureType });

    future.get.mockResolvedValue(found);

    await expect(service.get(projectId, workloadId)).resolves.toBe(found);
    expect(future.get).toHaveBeenCalledWith(projectId, workloadId);
    expect(docker.get).not.toHaveBeenCalled();
  });

  it('propagates a missing row without selecting a type service', async () => {
    const docker = createTypeService('docker');
    const registry = createRegistry([docker]);
    const resolver: ResolverFake = {
      resolve: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Workload not found')),
    };
    const service = createService(registry, resolver);

    await expect(service.get(projectId, workloadId)).rejects.toThrow(
      'Workload not found',
    );
    expect(registry.get).not.toHaveBeenCalled();
  });
});

describe('WorkloadService.env', () => {
  it('delegates to the Docker service for a Docker workload', async () => {
    const docker = { type: 'docker' as const, getEnv: jest.fn() };
    const env = { env: [{ key: 'FOO', value: 'bar' }] };
    const service = createService(
      createRegistry([]),
      createResolver('docker'),
      createProjectService(),
      undefined,
      docker,
    );

    docker.getEnv.mockResolvedValue(env);

    await expect(service.env(projectId, workloadId)).resolves.toBe(env);
    expect(docker.getEnv).toHaveBeenCalledWith(projectId, workloadId);
  });

  it('rejects other workload types', async () => {
    const docker = { type: 'docker' as const, getEnv: jest.fn() };
    const service = createService(
      createRegistry([]),
      createResolver('s3_bucket'),
      createProjectService(),
      undefined,
      docker,
    );

    await expect(service.env(projectId, workloadId)).rejects.toThrow(
      BadRequestException,
    );
    expect(docker.getEnv).not.toHaveBeenCalled();
  });
});
