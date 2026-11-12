import { BadRequestException, ConflictException } from '@nestjs/common';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadRow } from '../../schemas/workload.schema';
import { normalizeAllowedCidrs, normalizeNodePort } from '../postgres.config';
import {
  buildCluster,
  buildClusterPolicy,
  buildExternalService,
  tlsOutsidePodNetwork,
} from '../postgres.manifests';
import {
  generatePassword,
  PostgresAccessService,
} from '../postgres-access.service';
import type { PostgresWorkloadService } from '../postgres.service';
import { normalizePostgresConfig } from '../postgres.config';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('../postgres.service', () => ({
  PostgresWorkloadService: class PostgresWorkloadService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const namespace = `project-${projectId}`;
const input = {
  id: workloadId,
  project_id: projectId,
  name: 'Orders DB',
  external_name: 'orders-db-3f9a1b2c',
};
const row = { ...input, type: 'postgres' } as WorkloadRow;

const argsOf = <T>(fn: jest.Mock): T[] =>
  fn.mock.calls.map((call: unknown[]) => call[0] as T);

const notFound = () =>
  Object.assign(new Error('not found'), { code: 404, statusCode: 404 });

describe('exposure validation', () => {
  it('turns bare addresses into host networks and drops repeats', () => {
    expect(
      normalizeAllowedCidrs([
        ' 203.0.113.7 ',
        '203.0.113.7/32',
        '2001:db8::/32',
      ]),
    ).toEqual(['203.0.113.7/32', '2001:db8::/32']);
  });

  it.each([
    [[]],
    [undefined],
    [['not-an-ip']],
    [['10.0.0.0/33']],
    [['10.0.0.0/8/1']],
    [['10.0.0.0/x']],
    [Array.from({ length: 21 }, (_, index) => `10.0.0.${index}`)],
  ])('rejects %j', (cidrs) => {
    expect(() => normalizeAllowedCidrs(cidrs)).toThrow(BadRequestException);
  });

  it('accepts node ports in the Kubernetes range only', () => {
    expect(normalizeNodePort(undefined)).toBeNull();
    expect(normalizeNodePort(30432)).toBe(30432);
    expect(() => normalizeNodePort(5432)).toThrow(BadRequestException);
    expect(() => normalizeNodePort(32768)).toThrow(BadRequestException);
  });
});

describe('exposure manifests', () => {
  it('requires TLS outside the pod network on every new Cluster', () => {
    const cluster = buildCluster(
      input,
      normalizePostgresConfig({}),
      'longhorn',
      undefined,
      '10.60.0.0/16',
    );

    expect(cluster.spec.postgresql).toEqual({
      pg_hba: [
        'hostnossl all all 10.60.0.0/16 scram-sha-256',
        'hostnossl all all 0.0.0.0/0 reject',
        'hostnossl all all ::/0 reject',
      ],
      parameters: { max_wal_size: '2560MB' },
    });
    expect(tlsOutsidePodNetwork()[0]).toContain('10.42.0.0/16');
  });

  it('opens 5432 to the allowed networks only while exposed', () => {
    expect(buildClusterPolicy(input).spec.ingress).toHaveLength(2);
    expect(
      buildClusterPolicy(input, 'cnpg-system', ['203.0.113.0/24']).spec
        .ingress[2],
    ).toEqual({
      fromCIDR: ['203.0.113.0/24'],
      toPorts: [{ ports: [{ port: '5432', protocol: 'TCP' }] }],
    });
  });

  it('keeps the client address and targets the primary', () => {
    const service = buildExternalService(input, ['203.0.113.0/24'], 30432);

    expect(service.metadata?.name).toBe('orders-db-3f9a1b2c-external');
    expect(
      service.metadata?.annotations?.['acceleratio.io/allowed-cidrs'],
    ).toBe('203.0.113.0/24');
    expect(service.spec).toMatchObject({
      type: 'NodePort',
      externalTrafficPolicy: 'Local',
      selector: {
        'cnpg.io/cluster': input.external_name,
        'cnpg.io/instanceRole': 'primary',
      },
      ports: [{ port: 5432, nodePort: 30432 }],
    });
    expect(
      buildExternalService(input, [], null).spec?.ports?.[0],
    ).not.toHaveProperty('nodePort');
  });
});

const createService = () => {
  const kubernetes = {
    coreV1: {
      readNamespacedService: jest.fn().mockRejectedValue(notFound()),
      createNamespacedService: jest.fn().mockResolvedValue({}),
      patchNamespacedService: jest.fn().mockResolvedValue({}),
      deleteNamespacedService: jest.fn().mockResolvedValue({}),
      patchNamespacedSecret: jest.fn().mockResolvedValue({}),
      listNamespacedPod: jest.fn().mockResolvedValue({ items: [] }),
      readNode: jest.fn(),
    },
    customObjects: {
      getNamespacedCustomObject: jest.fn(),
      patchNamespacedCustomObject: jest.fn().mockResolvedValue({}),
      createNamespacedCustomObject: jest.fn().mockResolvedValue({}),
      replaceNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    },
  };
  const databases = { findDatabase: jest.fn().mockResolvedValue(row) };

  return {
    kubernetes,
    service: new PostgresAccessService(
      databases as unknown as PostgresWorkloadService,
      kubernetes as unknown as KubernetesService,
    ),
  };
};

/** A Cluster from before the TLS rule, then the existing policy. */
const mockClusterAndPolicy = (
  kubernetes: ReturnType<typeof createService>['kubernetes'],
) =>
  kubernetes.customObjects.getNamespacedCustomObject.mockImplementation(
    ({ plural }: { plural: string }) =>
      Promise.resolve(
        plural === 'clusters'
          ? { spec: { postgresql: { parameters: {} } } }
          : { metadata: { resourceVersion: '7' } },
      ),
  );

describe('PostgresAccessService', () => {
  it('reports a closed port while the external Service is absent', async () => {
    const { service } = createService();

    await expect(service.exposure(projectId, workloadId)).resolves.toEqual({
      enabled: false,
      allowed_cidrs: [],
      node_port: null,
      host: null,
    });
  });

  it('opens the port: TLS rule, then the policy, then the Service', async () => {
    const { service, kubernetes } = createService();
    const order: string[] = [];

    mockClusterAndPolicy(kubernetes);
    kubernetes.customObjects.patchNamespacedCustomObject.mockImplementation(
      () => {
        order.push('tls');
        return Promise.resolve({});
      },
    );
    kubernetes.customObjects.replaceNamespacedCustomObject.mockImplementation(
      () => {
        order.push('policy');
        return Promise.resolve({});
      },
    );
    kubernetes.coreV1.createNamespacedService.mockImplementation(() => {
      order.push('service');
      return Promise.resolve({});
    });

    await service.updateExposure(projectId, workloadId, {
      enabled: true,
      allowed_cidrs: ['203.0.113.7'],
    });

    expect(order).toEqual(['tls', 'policy', 'service']);
    const [tls] = argsOf<{ body: Array<{ path: string }> }>(
      kubernetes.customObjects.patchNamespacedCustomObject,
    );
    const [policy] = argsOf<{
      body: {
        metadata: { resourceVersion: string };
        spec: { ingress: unknown[] };
      };
    }>(kubernetes.customObjects.replaceNamespacedCustomObject);
    const [created] = argsOf<{
      namespace: string;
      body: { spec: { ports: object[] } };
    }>(kubernetes.coreV1.createNamespacedService);

    expect(tls.body[0].path).toBe('/spec/postgresql/pg_hba');
    expect(policy.body.metadata.resourceVersion).toBe('7');
    expect(policy.body.spec.ingress[2]).toMatchObject({
      fromCIDR: ['203.0.113.7/32'],
    });
    expect(created.namespace).toBe(namespace);
    expect(created.body.spec.ports[0]).not.toHaveProperty('nodePort');
  });

  it('refuses to open the port without a network', async () => {
    const { service, kubernetes } = createService();

    await expect(
      service.updateExposure(projectId, workloadId, { enabled: true }),
    ).rejects.toThrow(BadRequestException);
    expect(kubernetes.coreV1.createNamespacedService).not.toHaveBeenCalled();
  });

  it('closes the port: deletes the Service and the CIDR rule', async () => {
    const { service, kubernetes } = createService();

    mockClusterAndPolicy(kubernetes);
    await service.updateExposure(projectId, workloadId, {
      enabled: false,
      allowed_cidrs: ['0.0.0.0/0'],
    });

    expect(kubernetes.coreV1.deleteNamespacedService).toHaveBeenCalledWith({
      name: 'orders-db-3f9a1b2c-external',
      namespace,
    });
    const [policy] = argsOf<{ body: { spec: { ingress: unknown[] } } }>(
      kubernetes.customObjects.replaceNamespacedCustomObject,
    );

    expect(policy.body.spec.ingress).toHaveLength(2);
  });

  it('answers 409 when the node port is taken', async () => {
    const { service, kubernetes } = createService();

    mockClusterAndPolicy(kubernetes);
    kubernetes.coreV1.createNamespacedService.mockRejectedValue(
      Object.assign(
        new Error(
          'spec.ports[0].nodePort: Invalid value: 30432: provided port is already allocated',
        ),
        { code: 422, statusCode: 422 },
      ),
    );

    await expect(
      service.updateExposure(projectId, workloadId, {
        enabled: true,
        allowed_cidrs: ['0.0.0.0/0'],
        node_port: 30432,
      }),
    ).rejects.toThrow(ConflictException);

    // The CIDR rule written before the failed Service is taken back.
    const policies = argsOf<{ body: { spec: { ingress: unknown[] } } }>(
      kubernetes.customObjects.replaceNamespacedCustomObject,
    );

    expect(policies.map((call) => call.body.spec.ingress.length)).toEqual([
      3, 2,
    ]);
  });

  it('reports the open port and the address of the primary node', async () => {
    const { service, kubernetes } = createService();

    kubernetes.coreV1.readNamespacedService.mockResolvedValue({
      metadata: {
        annotations: {
          'acceleratio.io/allowed-cidrs': '203.0.113.0/24,0.0.0.0/0',
        },
      },
      spec: { ports: [{ nodePort: 31555 }] },
    });
    kubernetes.coreV1.listNamespacedPod.mockResolvedValue({
      items: [{ status: { phase: 'Running' }, spec: { nodeName: 'node-a' } }],
    });
    kubernetes.coreV1.readNode.mockResolvedValue({
      status: {
        addresses: [
          { type: 'InternalIP', address: '10.0.0.5' },
          { type: 'ExternalIP', address: '198.51.100.9' },
        ],
      },
    });

    await expect(service.exposure(projectId, workloadId)).resolves.toEqual({
      enabled: true,
      allowed_cidrs: ['203.0.113.0/24', '0.0.0.0/0'],
      node_port: 31555,
      host: '198.51.100.9',
    });
  });

  it('reads the current password from the Secret on request', async () => {
    const { service, kubernetes } = createService();

    Object.assign(kubernetes.coreV1, {
      readNamespacedSecret: jest.fn().mockResolvedValue({
        data: {
          username: Buffer.from('app').toString('base64'),
          password: Buffer.from('s3cret-value').toString('base64'),
        },
      }),
    });

    await expect(service.credentials(projectId, workloadId)).resolves.toEqual({
      username: 'app',
      password: 's3cret-value',
      secret_name: 'orders-db-3f9a1b2c-credentials',
    });
  });

  it('writes a new password to the Secret and returns it once', async () => {
    const { service, kubernetes } = createService();

    const credentials = await service.rotateCredentials(projectId, workloadId);
    const [patch] = argsOf<{
      name: string;
      body: Array<{ op: string; path: string; value: string }>;
    }>(kubernetes.coreV1.patchNamespacedSecret);

    expect(credentials.username).toBe('app');
    expect(credentials.password).toHaveLength(32);
    expect(patch.name).toBe('orders-db-3f9a1b2c-credentials');
    expect(patch.body).toEqual([
      {
        op: 'replace',
        path: '/data/password',
        value: Buffer.from(credentials.password).toString('base64'),
      },
    ]);
  });

  it('generates a different URL-safe password every time', () => {
    const first = generatePassword();

    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generatePassword()).not.toBe(first);
  });
});
