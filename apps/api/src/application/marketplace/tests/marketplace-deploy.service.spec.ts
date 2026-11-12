import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

import { MarketplaceDeployService } from '../marketplace-deploy.service';
import type { MarketplaceTemplate } from '../marketplace-template';

// The real services pull in the Kubernetes client, which Jest cannot load.
jest.mock('@/application/project/project.service', () => ({
  ProjectService: class {},
}));
jest.mock('@/application/system/control-plane-dns.service', () => ({
  ControlPlaneDnsService: class {},
}));
jest.mock('@/application/workload/workload.service', () => ({
  WorkloadService: class {},
}));
jest.mock(
  '@/application/workload/docker/docker-workload-network.service',
  () => ({
    DockerWorkloadNetworkService: class {},
    PUBLIC_IP_UNKNOWN_MESSAGE: 'No public IP',
  }),
);
jest.mock('@/application/workload/postgres/postgres-access.service', () => ({
  PostgresAccessService: class {},
}));
jest.mock('../marketplace.service', () => ({ MarketplaceService: class {} }));

const PROJECT = '11111111-1111-4111-8111-111111111111';
const EXISTING = '22222222-2222-4222-8222-222222222222';

const template = {
  slug: 'demo',
  inputs: [{ name: 'EMAIL', label: 'Email', required: true }],
  services: [
    {
      name: 'demo',
      type: 'docker',
      image: 'example/demo:1.0.0',
      port: 3000,
      public: true,
      env: [
        {
          key: 'DATABASE_URL',
          value:
            'postgres://${{ service.postgres.user }}:${{ service.postgres.password }}@${{ service.postgres.host }}/${{ service.postgres.database }}',
        },
        { key: 'URL', value: '${{ app.url }}' },
        { key: 'EMAIL', value: '${{ input.EMAIL }}' },
      ],
    },
    {
      name: 'postgres',
      type: 'postgres',
      size_gib: 5,
      env: [],
    },
    {
      name: 'redis',
      type: 'docker',
      image: 'redis:7.4.12-alpine',
      volumes: [{ path: '/data', size_gib: 1 }],
      env: [{ key: 'REDIS_PASSWORD', value: '${{ password.redis }}' }],
    },
  ],
} as unknown as MarketplaceTemplate;

const setup = () => {
  let next = 0;
  const projects = {
    exists: jest.fn((id: string) => Promise.resolve(id === EXISTING)),
    create: jest.fn(() => Promise.resolve({ id: PROJECT })),
    remove: jest.fn(() => Promise.resolve()),
  };
  // Names already in the project, as the select().from().where() chain returns them.
  const existingNames: { name: string }[] = [];
  const db = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(existingNames) }),
    }),
  };
  const workloads = {
    create: jest.fn((project: string, body: { name: string; type: string }) => {
      next += 1;
      return Promise.resolve({
        id: `w${next}`,
        name: body.name,
        internal_domain: `${body.name}.internal`,
        ...(body.type === 'postgres'
          ? {
              postgres: {
                host: `${body.name}-rw`,
                username: 'app',
                database: 'app',
              },
            }
          : {}),
      });
    }),
    update: jest.fn(() => Promise.resolve({})),
    deploy: jest.fn((project: string, id: string) => Promise.resolve({ id })),
    remove: jest.fn((project: string, id: string) => Promise.resolve(void id)),
  };
  const network = {
    list: jest.fn(() => Promise.resolve({ suggested_label: 'demo' })),
    generate: jest.fn(
      (project: string, workload: string, body: { label: string }) =>
        Promise.resolve({ hostname: `${body.label}-1-2-3-4.sslip.io` }),
    ),
  };
  const dns = {
    expectedIp: jest.fn(() => Promise.resolve<string | null>('1.2.3.4')),
  };
  const marketplace = {
    find: jest.fn((slug: string) => (slug === 'demo' ? template : undefined)),
  };
  const postgres = {
    credentials: jest.fn(() => Promise.resolve({ password: 'pg-secret' })),
  };
  const service = new MarketplaceDeployService(
    db as never,
    marketplace as never,
    projects as never,
    workloads as never,
    network as never,
    dns as never,
    postgres as never,
  );
  return {
    service,
    projects,
    workloads,
    network,
    dns,
    postgres,
    existingNames,
  };
};

const payload = (extra: Record<string, unknown> = {}) =>
  ({ name: 'demo', inputs: { EMAIL: 'me@example.com' }, ...extra }) as never;

describe('MarketplaceDeployService', () => {
  it('creates, wires and deploys every service of a new project', async () => {
    const { service, projects, workloads, network, postgres } = setup();

    const result = await service.deploy(
      'demo',
      payload({ project_name: 'Demo' }),
      null,
    );

    expect(result).toEqual({
      project_id: PROJECT,
      workload_ids: ['w1', 'w2', 'w3'],
      url: 'https://demo-1-2-3-4.sslip.io',
    });
    expect(projects.create).toHaveBeenCalledWith({ name: 'Demo' });
    expect(workloads.create.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ name: 'demo', type: 'docker' }),
      {
        name: 'demo-postgres',
        type: 'postgres',
        config: {
          postgres_version: '17',
          size_gb: 5,
          storage_class_id: null,
        },
      },
      expect.objectContaining({
        name: 'demo-redis',
        type: 'docker',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        config: expect.objectContaining({
          volumes: [
            { mount_path: '/data', size_gb: 1, storage_class_id: null },
          ],
        }),
      }),
    ]);
    expect(postgres.credentials).toHaveBeenCalledWith(PROJECT, 'w2');
    expect(network.generate).toHaveBeenCalledWith(PROJECT, 'w1', {
      label: 'demo',
      port: 3000,
    });

    const env = (index: number) =>
      Object.fromEntries(
        (
          workloads.update.mock.calls[index] as unknown as [
            string,
            string,
            { config: { env: { key: string; value: string }[] } },
          ]
        )[2].config.env.map(({ key, value }) => [key, value]),
      );
    // The postgres service has no env to fill.
    expect(workloads.update.mock.calls.map((call) => call.at(1))).toEqual([
      'w1',
      'w3',
    ]);
    expect(env(1).REDIS_PASSWORD).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(env(0)).toEqual({
      DATABASE_URL: 'postgres://app:pg-secret@demo-postgres-rw/app',
      URL: 'https://demo-1-2-3-4.sslip.io',
      EMAIL: 'me@example.com',
    });
    // A postgres service runs from creation; only the containers deploy.
    expect(workloads.deploy.mock.calls.map((call) => call[1])).toEqual([
      'w1',
      'w3',
    ]);
  });

  it('retries the domain with a suffix when the label is taken', async () => {
    const { service, network } = setup();
    network.generate.mockRejectedValueOnce(new ConflictException('taken'));

    const result = await service.deploy(
      'demo',
      payload({ project_id: EXISTING }),
      null,
    );

    expect(network.generate).toHaveBeenCalledTimes(2);
    expect(result.url).toMatch(
      /^https:\/\/demo-[0-9a-f]{6}-1-2-3-4\.sslip\.io$/,
    );
  });

  it('creates nothing when the public IP is unknown', async () => {
    const { service, projects, workloads, dns } = setup();
    dns.expectedIp.mockResolvedValue(null);

    await expect(
      service.deploy('demo', payload({ project_name: 'Demo' }), null),
    ).rejects.toThrow('No public IP');
    expect(projects.create).not.toHaveBeenCalled();
    expect(workloads.create).not.toHaveBeenCalled();
  });

  it('refuses names already used in the project before creating anything', async () => {
    const { service, workloads, existingNames } = setup();
    existingNames.push({ name: 'Demo-Postgres' });

    await expect(
      service.deploy('demo', payload({ project_id: EXISTING }), null),
    ).rejects.toThrow('already has a service named "demo-postgres"');
    expect(workloads.create).not.toHaveBeenCalled();
  });

  it('runs deploys into one project one after another', async () => {
    const { service, workloads, existingNames } = setup();
    // The first deploy's services show up in the project once it creates them.
    workloads.create.mockImplementation(
      (project: string, body: { name: string }) => {
        existingNames.push({ name: body.name });
        return Promise.resolve({
          id: body.name,
          name: body.name,
          internal_domain: `${body.name}.internal`,
          postgres: {
            host: `${body.name}-rw`,
            username: 'app',
            database: 'app',
          },
        });
      },
    );

    const results = await Promise.allSettled([
      service.deploy('demo', payload({ project_id: EXISTING }), null),
      service.deploy('demo', payload({ project_id: EXISTING }), null),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining('already has a service') as unknown,
      }) as unknown,
    });
    expect(workloads.create).toHaveBeenCalledTimes(3);
  });

  it('rejects bad requests before creating anything', async () => {
    const { service, projects, workloads } = setup();
    const fails = (body: Record<string, unknown>, error: unknown) =>
      expect(service.deploy('demo', body as never, null)).rejects.toThrow(
        error as never,
      );

    await fails(payload(), BadRequestException);
    await fails(
      payload({ project_id: EXISTING, project_name: 'Demo' }),
      BadRequestException,
    );
    await fails(payload({ project_id: PROJECT }), NotFoundException);
    await fails(payload({ project_id: 'not-a-uuid' }), NotFoundException);
    await fails(payload({ project_name: 7 }), /project_name must be text/);
    await fails(
      payload({ project_name: 'Demo', name: 'x'.repeat(250) }),
      /would be named/,
    );
    await fails(
      { name: 'demo', project_name: 'Demo', inputs: {} },
      /Email is required/,
    );
    await expect(
      service.deploy('nope', payload({ project_name: 'Demo' }), null),
    ).rejects.toThrow(NotFoundException);
    expect(projects.create).not.toHaveBeenCalled();
    expect(workloads.create).not.toHaveBeenCalled();
  });

  it('removes a new project when a step fails', async () => {
    const { service, projects, workloads } = setup();
    workloads.deploy
      .mockResolvedValueOnce({ id: 'w1' })
      .mockRejectedValueOnce(new Error('apply failed'));

    await expect(
      service.deploy('demo', payload({ project_name: 'Demo' }), null),
    ).rejects.toThrow('apply failed');
    expect(projects.remove).toHaveBeenCalledWith(PROJECT);
    expect(workloads.remove).not.toHaveBeenCalled();
  });

  it('removes only its own services from an existing project', async () => {
    const { service, projects, workloads } = setup();
    workloads.create
      .mockResolvedValueOnce({
        id: 'w1',
        name: 'demo',
        internal_domain: 'demo.internal',
      })
      .mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      service.deploy('demo', payload({ project_id: EXISTING }), null),
    ).rejects.toThrow('insert failed');
    expect(workloads.remove.mock.calls).toEqual([[EXISTING, 'w1']]);
    expect(projects.remove).not.toHaveBeenCalled();
  });

  it('keeps removing services when one of them fails to go', async () => {
    const { service, workloads } = setup();
    workloads.deploy.mockRejectedValue(new Error('apply failed'));
    workloads.remove.mockRejectedValueOnce(new Error('still there'));

    await expect(
      service.deploy('demo', payload({ project_id: EXISTING }), null),
    ).rejects.toThrow(
      'The deploy failed. Services "demo" could not be removed; delete them in the console.',
    );
    expect(workloads.remove.mock.calls).toEqual([
      [EXISTING, 'w1'],
      [EXISTING, 'w2'],
      [EXISTING, 'w3'],
    ]);
  });

  it('says so when a new project cannot be removed, keeping the status', async () => {
    const { service, projects, network } = setup();
    network.generate.mockRejectedValue(new ConflictException('Domain taken.'));
    projects.remove.mockRejectedValue(new Error('namespace stuck'));

    const error: unknown = await service
      .deploy('demo', payload({ project_name: 'Demo' }), null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect((error as HttpException).message).toBe(
      'Domain taken. The new project could not be removed; delete it in the console.',
    );
  });
});
