import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { V1StorageClass } from '@kubernetes/client-node';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { StorageClassRow } from '../schemas/storage-class.schema';
import { buildStorageClass } from '../storage-class.manifests';
import {
  PLATFORM_FORBIDDEN_MESSAGE,
  StorageClassService,
} from '../storage-class.service';

// @kubernetes/client-node is ESM-only and Jest runs CommonJS. Only the class
// token is needed to construct the service.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const platformId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const customId = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const clusterError = (code: number) =>
  Object.assign(new Error(`Kubernetes ${code}`), { code, body: {} });

const platformRow: StorageClassRow = {
  id: platformId,
  kind: 'platform',
  name: 'Platform default',
  description: null,
  external_name: 'seaweedfs-storage',
  parameters: null,
  reclaim_policy: null,
  volume_binding_mode: null,
  allow_volume_expansion: false,
  created_at: new Date('2026-11-01T09:00:00.000Z'),
  updated_at: new Date('2026-11-01T09:00:00.000Z'),
};

const customRow: StorageClassRow = {
  id: customId,
  kind: 'custom',
  name: 'Fast',
  description: 'SSD tier',
  external_name: 'sc-fast-7c1d2e3f',
  parameters: {
    replication: '000',
    disk_type: 'ssd',
    collection: null,
    ttl: null,
    cache_capacity_mb: null,
    concurrent_writers: null,
    chunk_size_limit_mb: null,
    writeback_cache: false,
  },
  reclaim_policy: 'Delete',
  volume_binding_mode: 'Immediate',
  allow_volume_expansion: true,
  created_at: new Date('2026-11-02T09:00:00.000Z'),
  updated_at: new Date('2026-11-02T09:00:00.000Z'),
};

const managedObject = (): V1StorageClass =>
  buildStorageClass({
    id: customId,
    external_name: customRow.external_name,
    parameters: customRow.parameters!,
    reclaim_policy: 'Delete',
    volume_binding_mode: 'Immediate',
    allow_volume_expansion: true,
  });

const platformObject: V1StorageClass = {
  metadata: {
    name: 'seaweedfs-storage',
    annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' },
  },
  provisioner: 'seaweedfs-csi-driver',
  parameters: { dataLocality: 'none' },
  reclaimPolicy: 'Delete',
  volumeBindingMode: 'Immediate',
};

/** A chainable Drizzle stand-in: each terminal call resolves a queued value. */
const createDatabase = (rows: StorageClassRow[]) => {
  const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
  const insertReturning = jest.fn();
  const insertValues = jest
    .fn()
    .mockReturnValue({ onConflictDoNothing, returning: insertReturning });
  const insert = jest.fn().mockReturnValue({ values: insertValues });

  const orderBy = jest.fn().mockResolvedValue(rows);
  const limit = jest.fn((count: number) => {
    void count;
    return Promise.resolve(rows.slice(0, 1));
  });
  // S3 buckets on a profile: `select({ value: count() }).from().where()`
  // is awaited directly, while row lookups chain `.limit()`.
  const bucketCount = { value: 0 };
  const where = jest.fn(() =>
    Object.assign(Promise.resolve([bucketCount]), { limit }),
  );
  const from = jest.fn().mockReturnValue({ orderBy, where });
  const select = jest.fn().mockReturnValue({ from });

  // Latest benchmark per profile: `selectDistinctOn().from()[.where()].orderBy()`.
  const benchmarkOrderBy = jest.fn().mockResolvedValue([]);
  const benchmarkFrom = jest.fn().mockReturnValue({
    orderBy: benchmarkOrderBy,
    where: jest.fn().mockReturnValue({ orderBy: benchmarkOrderBy }),
  });
  const selectDistinctOn = jest.fn().mockReturnValue({ from: benchmarkFrom });

  const updateReturning = jest.fn().mockResolvedValue(rows.slice(0, 1));
  const set = jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({ returning: updateReturning }),
  });
  const update = jest.fn().mockReturnValue({ set });

  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockReturnValue({ where: deleteWhere });

  const txDeleteReturning = jest.fn().mockResolvedValue([{ id: customId }]);
  const txDelete = jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({ returning: txDeleteReturning }),
  });
  const transaction = jest.fn(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ delete: txDelete }),
  );

  return {
    db: {
      select,
      selectDistinctOn,
      insert,
      update,
      delete: remove,
      transaction,
    } as unknown as Database,
    insertValues,
    insertReturning,
    onConflictDoNothing,
    set,
    deleteWhere,
    txDelete,
    transaction,
    benchmarkOrderBy,
    bucketCount,
  };
};

const createService = (rows: StorageClassRow[]) => {
  const database = createDatabase(rows);
  const storageV1 = {
    listStorageClass: jest.fn().mockResolvedValue({ items: [] }),
    readStorageClass: jest.fn(),
    createStorageClass: jest.fn(),
    patchStorageClass: jest.fn().mockResolvedValue({}),
    deleteStorageClass: jest.fn().mockResolvedValue({}),
    readCSIDriver: jest.fn(),
  };
  const coreV1 = {
    listPersistentVolume: jest.fn().mockResolvedValue({ items: [] }),
    listPersistentVolumeClaimForAllNamespaces: jest
      .fn()
      .mockResolvedValue({ items: [] }),
  };
  const appsV1 = { readNamespacedStatefulSet: jest.fn() };
  const kubernetes = {
    storageV1,
    coreV1,
    appsV1,
  } as unknown as KubernetesService;

  return {
    service: new StorageClassService(database.db, kubernetes),
    ...database,
    storageV1,
    coreV1,
    appsV1,
  };
};

describe('StorageClassService.list', () => {
  it('ensures the platform row and presents both kinds from the cluster', async () => {
    const { service, insertValues, onConflictDoNothing, storageV1, coreV1 } =
      createService([platformRow, customRow]);

    storageV1.listStorageClass.mockResolvedValue({
      items: [platformObject, managedObject()],
    });
    coreV1.listPersistentVolume.mockResolvedValue({
      items: [
        { spec: { storageClassName: 'seaweedfs-storage' } },
        { spec: { storageClassName: 'seaweedfs-storage' } },
        { spec: { storageClassName: 'local-path' } },
      ],
    });

    const [platform, custom] = await service.list();

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'platform',
        external_name: 'seaweedfs-storage',
      }),
    );
    expect(onConflictDoNothing).toHaveBeenCalled();
    expect(platform).toMatchObject({
      kind: 'platform',
      editable: false,
      is_default: true,
      cluster_status: 'ready',
      volume_count: 2,
      parameters: { replication: '000' },
      extra_parameters: { dataLocality: 'none' },
      reclaim_policy: 'Delete',
    });
    expect(custom).toMatchObject({
      kind: 'custom',
      editable: true,
      is_default: false,
      cluster_status: 'ready',
      volume_count: 0,
      parameters: { disk_type: 'ssd' },
    });
  });

  it('attaches the latest benchmark of each profile', async () => {
    const { service, benchmarkOrderBy } = createService([customRow]);

    benchmarkOrderBy.mockResolvedValue([
      {
        id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
        storage_class_id: customId,
        storage_class_name: 'Fast',
        status: 'succeeded',
        status_message: null,
        results: {
          random_read_iops: 1000,
          random_write_iops: 500,
          sequential_read_mbps: 120,
          sequential_write_mbps: 90,
          random_read_latency_ms: 0.5,
          random_write_latency_ms: 1.2,
        },
        external_name: 'storage-benchmark-9d8c7b6a5f4e',
        started_at: new Date('2026-11-03T09:00:00.000Z'),
        finished_at: new Date('2026-11-03T09:02:00.000Z'),
        created_at: new Date('2026-11-03T09:00:00.000Z'),
        updated_at: new Date('2026-11-03T09:02:00.000Z'),
      },
    ]);

    const [custom] = await service.list();

    expect(custom.latest_benchmark).toMatchObject({
      status: 'succeeded',
      results: { random_read_iops: 1000 },
      finished_at: '2026-11-03T09:02:00.000Z',
    });
  });

  it('ensures the platform row once per process', async () => {
    const { service, onConflictDoNothing } = createService([platformRow]);

    await service.list();
    await service.list();

    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('degrades to unknown when the cluster is unreachable', async () => {
    const { service, storageV1 } = createService([platformRow, customRow]);

    storageV1.listStorageClass.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await service.list();

    expect(result.map((item) => item.cluster_status)).toEqual([
      'unknown',
      'unknown',
    ]);
    expect(result.map((item) => item.volume_count)).toEqual([null, null]);
    expect(result[0].parameters).toBeNull();
  });

  it('reports a missing platform class', async () => {
    const { service } = createService([platformRow]);

    const [platform] = await service.list();

    expect(platform.cluster_status).toBe('missing');
  });
});

describe('StorageClassService.create', () => {
  it('stores the row and creates a labeled StorageClass', async () => {
    const { service, insertValues, insertReturning, storageV1 } = createService(
      [],
    );

    insertReturning.mockImplementation(() =>
      Promise.resolve([
        {
          ...customRow,
          ...(insertValues.mock.calls.at(-1) as [Partial<StorageClassRow>])[0],
        },
      ]),
    );
    storageV1.createStorageClass.mockImplementation(
      ({ body }: { body: V1StorageClass }) => Promise.resolve(body),
    );

    const created = await service.create({
      name: 'Fast',
      parameters: { disk_type: 'ssd' },
    });

    const values = (insertValues.mock.calls[0] as [StorageClassRow])[0];
    const body = (
      storageV1.createStorageClass.mock.calls[0] as [{ body: V1StorageClass }]
    )[0].body;

    expect(values.kind).toBe('custom');
    expect(values.external_name).toMatch(/^sc-fast-[0-9a-f]{8}$/);
    expect(body.metadata?.name).toBe(values.external_name);
    expect(body.metadata?.labels?.['acceleratio.io/storage-class-id']).toBe(
      values.id,
    );
    expect(body.parameters).toEqual({ replication: '000', diskType: 'ssd' });
    expect(created.cluster_status).toBe('ready');
  });

  it('rolls the row back when the cluster rejects the class', async () => {
    const { service, insertReturning, storageV1, deleteWhere } = createService(
      [],
    );

    insertReturning.mockResolvedValue([customRow]);
    storageV1.createStorageClass.mockRejectedValue(clusterError(403));

    await expect(service.create({ name: 'Fast' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('maps a name already taken in the cluster to 409', async () => {
    const { service, insertReturning, storageV1, deleteWhere } = createService(
      [],
    );

    insertReturning.mockResolvedValue([customRow]);
    storageV1.createStorageClass.mockRejectedValue(clusterError(409));

    await expect(service.create({ name: 'Fast' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('retries with a longer id prefix on an external name conflict', async () => {
    const { service, insertValues, insertReturning, storageV1 } = createService(
      [],
    );

    insertReturning
      .mockRejectedValueOnce(
        Object.assign(new Error('duplicate'), {
          cause: {
            code: '23505',
            constraint: 'storage_class_external_name_unique',
          },
        }),
      )
      .mockResolvedValueOnce([customRow]);
    storageV1.createStorageClass.mockResolvedValue(managedObject());

    await service.create({ name: 'Fast' });

    const retried = (insertValues.mock.calls[1] as [StorageClassRow])[0];

    expect(retried.external_name).toMatch(/^sc-fast-[0-9a-f]{12}$/);
  });

  it('validates before touching the database', async () => {
    const { service, insertValues } = createService([]);

    await expect(
      service.create({ name: 'Fast', parameters: { replication: 'x' } }),
    ).rejects.toThrow('Replication');
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe('StorageClassService.update', () => {
  it('refuses to change the platform class', async () => {
    const { service, set, storageV1 } = createService([platformRow]);

    await expect(service.update(platformId, { name: 'Mine' })).rejects.toThrow(
      new ForbiddenException(PLATFORM_FORBIDDEN_MESSAGE),
    );
    expect(set).not.toHaveBeenCalled();
    expect(storageV1.patchStorageClass).not.toHaveBeenCalled();
  });

  it('refuses locked settings', async () => {
    const { service, set } = createService([customRow]);

    await expect(
      service.update(customId, { parameters: {} } as never),
    ).rejects.toThrow('Duplicate the class instead');
    expect(set).not.toHaveBeenCalled();
  });

  it('renames without touching the cluster', async () => {
    const { service, set, storageV1 } = createService([customRow]);

    await service.update(customId, { name: 'Faster' });

    expect(set).toHaveBeenCalledWith({ name: 'Faster' });
    expect(storageV1.readStorageClass).not.toHaveBeenCalled();
  });

  it('patches volume expansion on the managed object', async () => {
    const { service, set, storageV1 } = createService([customRow]);

    storageV1.readStorageClass.mockResolvedValue(managedObject());

    await service.update(customId, { allow_volume_expansion: false });

    expect(storageV1.patchStorageClass).toHaveBeenCalledWith({
      name: 'sc-fast-7c1d2e3f',
      body: [{ op: 'add', path: '/allowVolumeExpansion', value: false }],
    });
    expect(set).toHaveBeenCalledWith({ allow_volume_expansion: false });
  });

  it('never patches an object it does not manage', async () => {
    const { service, set, storageV1 } = createService([customRow]);

    storageV1.readStorageClass.mockResolvedValue({
      metadata: { name: 'sc-fast-7c1d2e3f' },
    });

    await expect(
      service.update(customId, { allow_volume_expansion: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storageV1.patchStorageClass).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

describe('StorageClassService.remove', () => {
  it('refuses to delete the platform class', async () => {
    const { service, transaction, storageV1 } = createService([platformRow]);

    await expect(service.remove(platformId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(storageV1.deleteStorageClass).not.toHaveBeenCalled();
  });

  it('is blocked while volumes or pending claims use the class', async () => {
    const { service, coreV1, transaction } = createService([customRow]);

    coreV1.listPersistentVolume.mockResolvedValue({
      items: [
        {
          metadata: { name: 'pv-1' },
          spec: { storageClassName: 'sc-fast-7c1d2e3f' },
        },
      ],
    });
    coreV1.listPersistentVolumeClaimForAllNamespaces.mockResolvedValue({
      items: [
        // Bound to pv-1: counted once.
        { spec: { storageClassName: 'sc-fast-7c1d2e3f', volumeName: 'pv-1' } },
        // Pending.
        { spec: { storageClassName: 'sc-fast-7c1d2e3f' } },
        { spec: { storageClassName: 'other' } },
      ],
    });

    await expect(service.remove(customId)).rejects.toThrow(
      'Storage class is used by 2 volumes. Delete them first.',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('is blocked while S3 buckets use the class', async () => {
    const { service, storageV1, transaction, bucketCount } = createService([
      customRow,
    ]);

    bucketCount.value = 1;

    await expect(service.remove(customId)).rejects.toThrow(
      'Storage class is used by 1 S3 bucket. Delete them first.',
    );
    expect(storageV1.deleteStorageClass).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('deletes the row and the managed object', async () => {
    const { service, storageV1, txDelete } = createService([customRow]);

    storageV1.readStorageClass.mockResolvedValue(managedObject());

    await service.remove(customId);

    expect(txDelete).toHaveBeenCalled();
    expect(storageV1.deleteStorageClass).toHaveBeenCalledWith({
      name: 'sc-fast-7c1d2e3f',
    });
  });

  it('deletes only the row when the object is already gone', async () => {
    const { service, storageV1, txDelete } = createService([customRow]);

    storageV1.readStorageClass.mockRejectedValue(clusterError(404));

    await service.remove(customId);

    expect(txDelete).toHaveBeenCalled();
    expect(storageV1.deleteStorageClass).not.toHaveBeenCalled();
  });

  it('never deletes an object it does not manage', async () => {
    const { service, storageV1, transaction } = createService([customRow]);

    storageV1.readStorageClass.mockResolvedValue({
      metadata: { name: 'sc-fast-7c1d2e3f' },
    });

    await expect(service.remove(customId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('maps a database reference to 409', async () => {
    const { service, storageV1, transaction } = createService([customRow]);

    storageV1.readStorageClass.mockResolvedValue(managedObject());
    transaction.mockRejectedValue(
      Object.assign(new Error('fk'), { cause: { code: '23503' } }),
    );

    await expect(service.remove(customId)).rejects.toThrow(
      'Storage class is still referenced by other resources',
    );
  });

  it('fails closed when volumes cannot be counted', async () => {
    const { service, coreV1, transaction } = createService([customRow]);

    coreV1.listPersistentVolume.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.remove(customId)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('StorageClassService.environment', () => {
  it('reports the CSI driver and volume servers', async () => {
    const { service, storageV1, appsV1 } = createService([]);

    storageV1.readCSIDriver.mockResolvedValue({});
    appsV1.readNamespacedStatefulSet.mockResolvedValue({
      spec: { replicas: 3 },
    });

    await expect(service.environment()).resolves.toEqual({
      csi_driver_installed: true,
      volume_servers: 3,
    });
    expect(appsV1.readNamespacedStatefulSet).toHaveBeenCalledWith({
      name: 'seaweedfs-volume',
      namespace: 'seaweedfs',
    });
  });

  it('distinguishes a missing driver from an unreachable cluster', async () => {
    const { service, storageV1, appsV1 } = createService([]);

    storageV1.readCSIDriver.mockRejectedValueOnce(clusterError(404));
    appsV1.readNamespacedStatefulSet.mockRejectedValue(clusterError(404));

    await expect(service.environment()).resolves.toEqual({
      csi_driver_installed: false,
      volume_servers: null,
    });

    storageV1.readCSIDriver.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.environment()).resolves.toMatchObject({
      csi_driver_installed: null,
    });
  });
});
