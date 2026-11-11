import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ProjectIsolationService } from '@/application/project/project-isolation.service';
import type { ProjectService } from '@/application/project/project.service';
import type { StorageClassService } from '@/application/storage-class/storage-class.service';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadEventsService } from '../../observer/workload-events.service';
import type { WorkloadRow } from '../../schemas/workload.schema';
import type { WorkloadVersionService } from '../../workload-version.service';
import {
  normalizePostgresConfig,
  updatePostgresConfig,
} from '../postgres.config';
import {
  buildCluster,
  buildClusterPolicy,
  buildCredentialsSecret,
  clusterStatus,
  type CnpgCluster,
} from '../postgres.manifests';
import {
  OVERVIEW_SQL,
  PostgresOverviewService,
  quoteIdent,
  quoteLiteral,
  rowsSql,
  tableExistsSql,
} from '../postgres-overview.service';
import { PostgresWorkloadService } from '../postgres.service';
import type { PostgresBackupService } from '../postgres-backup.service';

// These pull the ESM-only Kubernetes client; every instance is faked.
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
const namespace = `project-${projectId}`;
const input = {
  id: workloadId,
  project_id: projectId,
  name: 'Orders DB',
  external_name: 'orders-db-3f9a1b2c',
};

const row = (): WorkloadRow => ({
  ...input,
  auto_deploy: true,
  type: 'postgres',
  active_version_id: null,
  draft_config: null,
  position: { x: 0, y: 0 },
  internal_hostname: null,
  storage_class_id: null,
  last_deployed_at: new Date('2026-11-09T10:00:00.000Z'),
  created_at: new Date('2026-11-09T10:00:00.000Z'),
  updated_at: new Date('2026-11-09T10:00:00.000Z'),
});

const cluster = (
  status: CnpgCluster['status'],
  annotations: Record<string, string> = {},
): CnpgCluster => ({
  ...buildCluster(input, normalizePostgresConfig({}), 'seaweedfs-storage'),
  metadata: {
    name: input.external_name,
    namespace,
    labels: { 'acceleratio.io/workload-id': workloadId },
    annotations,
  },
  status,
});

describe('normalizePostgresConfig', () => {
  it('fills the version and disk size and keeps CPU/RAM absent', () => {
    expect(normalizePostgresConfig({})).toEqual({
      postgres_version: '17',
      size_gb: 10,
      storage_class_id: null,
    });
  });

  it.each([
    [{ postgres_version: '9' }],
    [{ size_gb: 0 }],
    [{ size_gb: 101 }],
    [{ size_gb: 1.5 }],
    [{ cpu_max: 0 }],
    [{ storage_class_id: 7 }],
  ])('rejects %j', (config) => {
    expect(() => normalizePostgresConfig(config)).toThrow(BadRequestException);
  });

  it('changes CPU and memory, grows the disk, keeps version and profile', () => {
    const current = normalizePostgresConfig({ size_gb: 5 });

    expect(updatePostgresConfig(current, { cpu_max: 2, size_gb: 5 })).toEqual({
      ...current,
      cpu_max: 2,
    });
    expect(updatePostgresConfig(current, { size_gb: 6 }).size_gb).toBe(6);
    expect(() => updatePostgresConfig(current, { size_gb: 4 })).toThrow(
      'can only grow',
    );
    expect(() => updatePostgresConfig(current, { size_gb: 101 })).toThrow(
      BadRequestException,
    );
    expect(() =>
      updatePostgresConfig(current, { postgres_version: '16' }),
    ).toThrow('cannot change');
  });
});

describe('postgres manifests', () => {
  it('builds a single-instance Cluster bootstrapped from the credentials Secret', () => {
    const body = buildCluster(
      input,
      normalizePostgresConfig({
        postgres_version: '16',
        size_gb: 3,
        ram_max: 512,
      }),
      'sc-fast',
    );

    expect(body.metadata).toMatchObject({
      name: input.external_name,
      namespace,
    });
    expect(body.spec).toMatchObject({
      instances: 1,
      imageName: 'ghcr.io/cloudnative-pg/postgresql:16',
      enablePDB: false,
      storage: { size: '3Gi', storageClass: 'sc-fast' },
      postgresql: { parameters: { max_wal_size: '768MB' } },
      resources: { limits: { cpu: '1', memory: '512Mi' } },
      bootstrap: {
        initdb: {
          database: 'app',
          owner: 'app',
          secret: { name: 'orders-db-3f9a1b2c-credentials' },
        },
      },
      inheritedMetadata: {
        labels: { 'acceleratio.io/workload-id': workloadId },
        annotations: {
          'prometheus.io/scrape': 'true',
          'prometheus.io/port': '9187',
        },
      },
    });
  });

  it('restores from the source bucket up to the target time', () => {
    const source = { ...input, id: 'src-id', external_name: 'orders-src' };
    const body = buildCluster(
      input,
      normalizePostgresConfig({ postgres_version: '17', size_gb: 2 }),
      'sc',
      undefined,
      undefined,
      {
        source,
        targetTime: '2026-11-10T12:00:00.000Z',
        endpoint: 'http://s3.test:8333',
      },
    );

    expect(body.spec.bootstrap).toEqual({
      recovery: {
        source: 'origin',
        database: 'app',
        owner: 'app',
        secret: { name: 'orders-db-3f9a1b2c-credentials' },
        recoveryTarget: { targetTime: '2026-11-10T12:00:00.000Z' },
      },
    });
    expect(body.spec).toMatchObject({
      externalClusters: [
        {
          name: 'origin',
          barmanObjectStore: {
            destinationPath: 's3://pg-backup-src-id/',
            serverName: 'orders-src',
            endpointURL: 'http://s3.test:8333',
          },
        },
      ],
    });
  });

  it('writes the password only into the Secret', () => {
    const secret = buildCredentialsSecret(input, 's3cret');

    expect(secret.type).toBe('kubernetes.io/basic-auth');
    expect(secret.stringData).toEqual({ username: 'app', password: 's3cret' });
    expect(secret.metadata?.labels?.['cnpg.io/reload']).toBe('true');
  });

  it('opens the cluster pods to the operator, the scraper and the API server only', () => {
    const policy = buildClusterPolicy(input, 'cnpg-system');

    expect(policy.spec.endpointSelector.matchLabels).toEqual({
      'cnpg.io/cluster': input.external_name,
    });
    expect(policy.spec.ingress).toEqual([
      {
        fromEndpoints: [
          { matchLabels: { 'k8s:io.kubernetes.pod.namespace': 'cnpg-system' } },
        ],
      },
      {
        fromEndpoints: [
          {
            matchLabels: {
              'k8s:io.kubernetes.pod.namespace': 'victoria-metrics',
            },
          },
        ],
        toPorts: [{ ports: [{ port: '9187', protocol: 'TCP' }] }],
      },
    ]);
    expect(policy.spec.egress).toEqual([{ toEntities: ['kube-apiserver'] }]);
  });
});

describe('clusterStatus', () => {
  it.each([
    [{ phase: 'Cluster in healthy state', readyInstances: 1 }, {}, 'running'],
    [{ phase: 'Setting up primary' }, {}, 'deploying'],
    [{ phase: 'Unable to create required cluster objects' }, {}, 'failed'],
    [{}, { 'cnpg.io/hibernation': 'on' }, 'deploying'],
    [
      { conditions: [{ type: 'cnpg.io/hibernation', status: 'True' }] },
      { 'cnpg.io/hibernation': 'on' },
      'stopped',
    ],
  ])('maps %j %j to %s', (status, annotations, expected) => {
    expect(clusterStatus(cluster(status, annotations)).status).toBe(expected);
  });

  it('reports a missing Cluster as failed', () => {
    expect(clusterStatus(null).status).toBe('failed');
  });
});

describe('overview SQL', () => {
  it('quotes identifiers and literals', () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteLiteral("it's")).toBe("'it''s'");
  });

  it('returns JSON from every query, since psql prints a bare boolean as t/f', () => {
    expect(tableExistsSql('public', 'orders')).toMatch(
      /^\s*select to_json\(exists/,
    );
  });

  it('leaves its own session out of the connection count', () => {
    expect(OVERVIEW_SQL).toContain('pid <> pg_backend_pid()),');
  });

  it('checks the catalog with the names as literals and excludes system schemas', () => {
    const sql = tableExistsSql('public', "x'; drop table t; --");

    expect(sql).toContain("c.relname = 'x''; drop table t; --'");
    expect(sql).toContain("not in ('pg_catalog', 'information_schema')");
  });

  it('reads one page plus one row at the page offset', () => {
    const sql = rowsSql('public', 'orders', 2);

    expect(sql).toContain('from "public"."orders" limit 51 offset 100');
  });
});

/** The first argument of every call, typed for the assertions. */
const argsOf = <T>(fn: jest.Mock): T[] =>
  fn.mock.calls.map((call: unknown[]) => call[0] as T);

const createDatabase = (selects: unknown[][]) => {
  const chain = (resolve: () => unknown) => {
    const query: Record<string, unknown> = {};

    for (const step of [
      'from',
      'where',
      'limit',
      'orderBy',
      'returning',
      'values',
      'set',
    ]) {
      query[step] = jest.fn(() => query);
    }

    query.then = (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled);

    return query;
  };
  const deletes = jest.fn(() => chain(() => []));

  return {
    db: {
      select: jest.fn(() => chain(() => selects.shift() ?? [])),
      insert: jest.fn(() => chain(() => [row()])),
      update: jest.fn(() => chain(() => [row()])),
      delete: deletes,
    } as unknown as Database,
    deletes,
  };
};

const createKubernetes = () => ({
  coreV1: {
    createNamespacedSecret: jest.fn().mockResolvedValue({}),
    deleteNamespacedSecret: jest.fn().mockResolvedValue({}),
    deleteNamespacedService: jest.fn().mockResolvedValue({}),
    listNamespacedPod: jest.fn(),
  },
  storageV1: {
    readStorageClass: jest
      .fn()
      .mockResolvedValue({ allowVolumeExpansion: true }),
  },
  customObjects: {
    patchNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    createNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    deleteNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    getNamespacedCustomObject: jest
      .fn()
      .mockResolvedValue(cluster({ phase: 'Setting up primary' })),
  },
  runInPod: jest.fn(),
});

const createService = (selects: unknown[][]) => {
  const { db, deletes } = createDatabase(selects);
  const kubernetes = createKubernetes();
  const versions = {
    record: jest.fn().mockResolvedValue({}),
    findByIds: jest.fn().mockResolvedValue(new Map()),
  };
  const backups = {
    ensure: jest.fn(),
    disable: jest.fn().mockResolvedValue(undefined),
    assertNotRestoringFrom: jest.fn().mockResolvedValue(undefined),
    flushWal: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    firstRecoverabilityPoint: jest
      .fn()
      .mockResolvedValue('2026-11-10T03:00:00Z'),
    endpoint: 'http://s3.test:8333',
  };
  const service = new PostgresWorkloadService(
    db,
    { exists: jest.fn().mockResolvedValue(true) } as unknown as ProjectService,
    { ensure: jest.fn() } as unknown as ProjectIsolationService,
    kubernetes as unknown as KubernetesService,
    { publish: jest.fn() } as unknown as WorkloadEventsService,
    versions as unknown as WorkloadVersionService,
    {
      kubernetesName: jest.fn().mockResolvedValue('seaweedfs-storage'),
    } as unknown as StorageClassService,
    backups as unknown as PostgresBackupService,
  );

  return { service, kubernetes, versions, deletes, backups };
};

describe('PostgresWorkloadService', () => {
  afterEach(() => jest.useRealTimers());

  it('creates the Secret, policy and Cluster and never returns the password', async () => {
    jest.useFakeTimers();
    // nextWorkloadPosition, then get() → findRow.
    const { service, kubernetes, versions, backups } = createService([
      [],
      [row()],
    ]);

    const created = await service.create(projectId, {
      name: 'Orders DB',
      type: 'postgres',
      config: { postgres_version: '17', size_gb: 2, storage_class_id: null },
    });

    const [secret] = argsOf<{ body: { stringData: { password: string } } }>(
      kubernetes.coreV1.createNamespacedSecret,
    );
    const password = secret.body.stringData.password;

    expect(password.length).toBeGreaterThanOrEqual(32);
    expect(
      argsOf<{ plural: string }>(
        kubernetes.customObjects.createNamespacedCustomObject,
      ).map((request) => request.plural),
    ).toEqual(['ciliumnetworkpolicies', 'clusters']);
    expect(versions.record).toHaveBeenCalledWith(
      expect.objectContaining({ workloadId: workloadId }),
    );
    expect(created.status).toBe('deploying');
    expect(created.postgres).toEqual({
      host: `orders-db-3f9a1b2c-rw.${namespace}.svc`,
      port: 5432,
      database: 'app',
      username: 'app',
      secret_name: 'orders-db-3f9a1b2c-credentials',
    });
    expect(JSON.stringify(created)).not.toContain(password);
    expect(backups.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ id: workloadId }),
    );
    service.onModuleDestroy();
  });

  it('refuses a restore time outside the backup window', async () => {
    const { service, versions } = createService([
      [{ ...row(), active_version_id: 'v1' }],
    ]);

    versions.findByIds.mockResolvedValue(
      new Map([['v1', { config: normalizePostgresConfig({ size_gb: 1 }) }]]),
    );

    await expect(
      service.restore(projectId, workloadId, {
        name: 'Orders copy',
        target_time: '2026-11-01T00:00:00Z',
      }),
    ).rejects.toThrow('Pick a time between');
  });

  it('deletes the Cluster, external Service, Secret and policy before the row', async () => {
    const { service, kubernetes, deletes, backups } = createService([[row()]]);

    await service.remove(projectId, workloadId);

    expect(backups.assertNotRestoringFrom).toHaveBeenCalled();
    expect(backups.remove).toHaveBeenCalled();
    expect(
      argsOf<{ plural: string }>(
        kubernetes.customObjects.deleteNamespacedCustomObject,
      ).map((request) => request.plural),
    ).toEqual(['clusters', 'ciliumnetworkpolicies']);
    expect(kubernetes.coreV1.deleteNamespacedSecret).toHaveBeenCalled();
    expect(kubernetes.coreV1.deleteNamespacedService).toHaveBeenCalledWith({
      name: 'orders-db-3f9a1b2c-external',
      namespace,
    });
    expect(deletes).toHaveBeenCalledTimes(1);
  });

  it('turns backups off and on as a version, without touching the Cluster', async () => {
    const config = normalizePostgresConfig({ size_gb: 1 });
    const { service, kubernetes, versions, backups } = createService([
      [{ ...row(), active_version_id: 'v1' }],
      [row()],
      [{ ...row(), active_version_id: 'v2' }],
      [row()],
    ]);

    versions.findByIds.mockResolvedValueOnce(new Map([['v1', { config }]]));
    await service.update(projectId, workloadId, {
      config: { ...config, backups: false },
    });

    expect(backups.disable).toHaveBeenCalledTimes(1);
    expect(versions.record).toHaveBeenCalledWith(
      expect.objectContaining({ config: { ...config, backups: false } }),
    );
    expect(
      kubernetes.customObjects.patchNamespacedCustomObject,
    ).not.toHaveBeenCalled();

    versions.findByIds.mockResolvedValueOnce(
      new Map([['v2', { config: { ...config, backups: false } }]]),
    );
    await service.update(projectId, workloadId, {
      config: { ...config, backups: true },
    });

    expect(backups.ensure).toHaveBeenCalledTimes(1);
    expect(backups.disable).toHaveBeenCalledTimes(1);
  });

  it('grows the disk in place and raises the WAL cap with it', async () => {
    const config = normalizePostgresConfig({ size_gb: 1 });
    // findRow, then get() → findRow.
    const { service, kubernetes, versions } = createService([
      [{ ...row(), active_version_id: 'v1' }],
      [row()],
    ]);

    versions.findByIds.mockResolvedValue(new Map([['v1', { config }]]));

    await service.update(projectId, workloadId, {
      config: { ...config, size_gb: 3 },
    });

    const [patch] = argsOf<{ body: Array<{ path: string; value: unknown }> }>(
      kubernetes.customObjects.patchNamespacedCustomObject,
    );

    expect(patch.body).toEqual([
      { op: 'replace', path: '/spec/storage/size', value: '3Gi' },
      {
        op: 'add',
        path: '/spec/postgresql/parameters/max_wal_size',
        value: '768MB',
      },
    ]);
    expect(versions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ size_gb: 3 }) as unknown,
      }),
    );
    service.onModuleDestroy();
  });

  it('refuses to grow a disk on a profile without expansion', async () => {
    const config = normalizePostgresConfig({ size_gb: 1 });
    const { service, kubernetes, versions } = createService([
      [{ ...row(), active_version_id: 'v1' }],
    ]);

    versions.findByIds.mockResolvedValue(new Map([['v1', { config }]]));
    kubernetes.storageV1.readStorageClass.mockResolvedValue({
      allowVolumeExpansion: false,
    });

    await expect(
      service.update(projectId, workloadId, {
        config: { ...config, size_gb: 2 },
      }),
    ).rejects.toThrow('does not allow growing');
    expect(
      kubernetes.customObjects.patchNamespacedCustomObject,
    ).not.toHaveBeenCalled();
  });

  it('rejects versioned deploys and rollbacks', async () => {
    const { service } = createService([]);

    await expect(service.deploy()).rejects.toThrow(BadRequestException);
    await expect(service.rollback()).rejects.toThrow(BadRequestException);
  });
});

describe('PostgresOverviewService', () => {
  const primary = {
    items: [
      {
        metadata: { name: 'orders-db-3f9a1b2c-1' },
        status: { phase: 'Running' },
      },
    ],
  };

  const create = () => {
    const { service: databases, kubernetes } = createService([
      [row()],
      [row()],
      [row()],
    ]);

    return {
      overview: new PostgresOverviewService(
        databases,
        kubernetes as unknown as KubernetesService,
      ),
      kubernetes,
    };
  };

  it('runs psql read-only in the primary pod and parses its JSON', async () => {
    const { overview, kubernetes } = create();

    kubernetes.coreV1.listNamespacedPod.mockResolvedValue(primary);
    kubernetes.runInPod.mockResolvedValue('[{"schema":"public","name":"t"}]\n');

    await expect(overview.tables(projectId, workloadId)).resolves.toEqual([
      { schema: 'public', name: 't' },
    ]);

    const [request] = argsOf<{
      pod: string;
      container: string;
      command: string[];
    }>(kubernetes.runInPod);

    expect(request.pod).toBe('orders-db-3f9a1b2c-1');
    expect(request.container).toBe('postgres');
    expect(request.command[1]).toContain('default_transaction_read_only=on');
    expect(request.command[1]).toContain('statement_timeout=');
  });

  it('does not read rows of a table the catalog does not list', async () => {
    const { overview, kubernetes } = create();

    kubernetes.coreV1.listNamespacedPod.mockResolvedValue(primary);
    kubernetes.runInPod.mockResolvedValue('false');

    await expect(
      overview.rows(projectId, workloadId, 'pg_catalog', 'pg_authid', '0'),
    ).rejects.toThrow(NotFoundException);
    expect(kubernetes.runInPod).toHaveBeenCalledTimes(1);
  });

  it('pages rows and reports whether more follow', async () => {
    const { overview, kubernetes } = create();
    const rows = Array.from({ length: 51 }, (_, index) => [String(index)]);

    kubernetes.coreV1.listNamespacedPod.mockResolvedValue(primary);
    kubernetes.runInPod
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce(JSON.stringify({ columns: ['id'], rows }));

    const page = await overview.rows(
      projectId,
      workloadId,
      'public',
      'orders',
      '0',
    );

    expect(page.rows).toHaveLength(50);
    expect(page.has_more).toBe(true);

    // A view's functions run with the reader's rights: rows are read as
    // the app owner, the catalog check as the superuser.
    const [check, read] = argsOf<{ command: string[] }>(kubernetes.runInPod);

    expect(check.command[1]).not.toContain('role=');
    expect(read.command[1]).toContain('-c role=app');
  });

  it('answers 403 when the app user cannot read the table', async () => {
    const { overview, kubernetes } = create();

    kubernetes.coreV1.listNamespacedPod.mockResolvedValue(primary);
    kubernetes.runInPod
      .mockResolvedValueOnce('true')
      .mockRejectedValueOnce(
        new Error('ERROR:  permission denied for table secrets'),
      );

    await expect(
      overview.rows(projectId, workloadId, 'public', 'secrets', '0'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('answers 503 instead of crashing when psql prints something other than JSON', async () => {
    const { overview, kubernetes } = create();

    kubernetes.coreV1.listNamespacedPod.mockResolvedValue(primary);
    kubernetes.runInPod.mockResolvedValue('t\n');

    await expect(overview.tables(projectId, workloadId)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('answers 409 when no primary pod runs', async () => {
    const { overview, kubernetes } = create();

    kubernetes.coreV1.listNamespacedPod.mockResolvedValue({ items: [] });

    await expect(overview.overview(projectId, workloadId)).rejects.toThrow(
      ConflictException,
    );
  });
});
