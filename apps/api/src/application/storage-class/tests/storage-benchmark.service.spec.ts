import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { StorageClass } from '@acceleratio/shared';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  FIO_JSON_BEGIN,
  FIO_JSON_END,
} from '../benchmark/storage-benchmark.manifests';
import { StorageBenchmarkService } from '../benchmark/storage-benchmark.service';
import type { StorageBenchmarkRow } from '../schemas/storage-benchmark.schema';
import type { StorageClassService } from '../storage-class.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('../storage-class.service', () => ({
  StorageClassService: class StorageClassService {},
}));

const storageClassId = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const benchmarkId = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const name = 'storage-benchmark-9d8c7b6a5f4e';
const namespace = 'acceleratio-benchmarks';

const clusterError = (code: number) =>
  Object.assign(new Error(`Kubernetes ${code}`), { code, body: {} });

const profile = (overrides: Partial<StorageClass> = {}) =>
  ({
    id: storageClassId,
    external_name: 'sc-fast-7c1d2e3f',
    cluster_status: 'ready',
    ...overrides,
  }) as StorageClass;

const runningRow = (
  overrides: Partial<StorageBenchmarkRow> = {},
): StorageBenchmarkRow => ({
  id: benchmarkId,
  storage_class_id: storageClassId,
  status: 'running',
  status_message: null,
  results: null,
  external_name: name,
  started_at: new Date(),
  finished_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const report = JSON.stringify({
  jobs: [
    'sequential-write',
    'sequential-read',
    'random-write',
    'random-read',
  ].map((jobname) => ({
    jobname,
    read: { iops: 100, bw_bytes: 1_000_000, lat_ns: { mean: 1_000_000 } },
    write: { iops: 50, bw_bytes: 2_000_000, lat_ns: { mean: 2_000_000 } },
  })),
});

const createService = (rows: StorageBenchmarkRow[] = []) => {
  const insertReturning = jest.fn();
  const insert = jest.fn().mockReturnValue({
    values: jest.fn().mockReturnValue({ returning: insertReturning }),
  });
  const updateReturning = jest.fn().mockResolvedValue([runningRow()]);
  const updateWhere = jest.fn().mockImplementation(() => {
    const result = Promise.resolve(undefined) as Promise<undefined> & {
      returning: jest.Mock;
    };

    result.returning = updateReturning;
    return result;
  });
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });
  const limit = jest.fn().mockResolvedValue(rows);
  const orderBy = jest.fn().mockReturnValue({ limit });
  const where = jest.fn().mockReturnValue({ limit, orderBy });
  const select = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({ where }),
  });

  const coreV1 = {
    readNamespace: jest.fn().mockResolvedValue({}),
    createNamespace: jest.fn(),
    createNamespacedPersistentVolumeClaim: jest.fn().mockResolvedValue({}),
    readNamespacedPersistentVolumeClaim: jest
      .fn()
      .mockResolvedValue({ spec: { volumeName: 'pvc-123' } }),
    deleteNamespacedPersistentVolumeClaim: jest.fn().mockResolvedValue({}),
    patchPersistentVolume: jest.fn().mockResolvedValue({}),
    listNamespacedPod: jest
      .fn()
      .mockResolvedValue({ items: [{ metadata: { name: `${name}-abcde` } }] }),
    readNamespacedPodLog: jest.fn(),
  };
  const batchV1 = {
    createNamespacedJob: jest.fn().mockResolvedValue({}),
    readNamespacedJob: jest.fn(),
    deleteNamespacedJob: jest.fn().mockResolvedValue({}),
  };
  const storageClasses = { get: jest.fn().mockResolvedValue(profile()) };
  const service = new StorageBenchmarkService(
    { select, insert, update } as unknown as Database,
    { coreV1, batchV1 } as unknown as KubernetesService,
    storageClasses as unknown as StorageClassService,
  );

  return {
    service,
    insertReturning,
    set,
    coreV1,
    batchV1,
    storageClasses,
  };
};

const lastState = (set: jest.Mock) =>
  (set.mock.calls.at(-1) as [Record<string, unknown>])[0];

afterEach(() => {
  jest.useRealTimers();
});

describe('StorageBenchmarkService.start', () => {
  it('creates the namespace, a claim of the profile and the Job', async () => {
    jest.useFakeTimers();
    const { service, insertReturning, coreV1, batchV1, set } = createService();

    insertReturning.mockImplementation(() =>
      Promise.resolve([runningRow({ status: 'pending' })]),
    );
    coreV1.readNamespace.mockRejectedValue(clusterError(404));

    const result = await service.start(storageClassId);

    expect(coreV1.createNamespace).toHaveBeenCalled();
    const claim = (
      coreV1.createNamespacedPersistentVolumeClaim.mock.calls[0] as [
        { namespace: string; body: { spec: { storageClassName: string } } },
      ]
    )[0];
    expect(claim.namespace).toBe(namespace);
    expect(claim.body.spec.storageClassName).toBe('sc-fast-7c1d2e3f');
    expect(batchV1.createNamespacedJob).toHaveBeenCalled();
    expect(lastState(set)).toMatchObject({ status: 'running' });
    expect(result.status).toBe('running');

    service.onModuleDestroy();
  });

  it('allows one run at a time', async () => {
    const { service, insertReturning, batchV1 } = createService();

    insertReturning.mockRejectedValue(
      Object.assign(new Error('duplicate'), {
        cause: { code: '23505', constraint: 'storage_benchmark_active_unique' },
      }),
    );

    await expect(service.start(storageClassId)).rejects.toThrow(
      'Another benchmark is running',
    );
    expect(batchV1.createNamespacedJob).not.toHaveBeenCalled();
  });

  it('refuses a profile missing from the cluster', async () => {
    const { service, storageClasses, insertReturning } = createService();

    storageClasses.get.mockResolvedValue(
      profile({ cluster_status: 'missing' }),
    );

    await expect(service.start(storageClassId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it('propagates an unknown profile', async () => {
    const { service, storageClasses } = createService();

    storageClasses.get.mockRejectedValue(new NotFoundException());

    await expect(service.start(storageClassId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('marks the run failed and cleans up when the cluster refuses', async () => {
    const { service, insertReturning, batchV1, coreV1, set } = createService();

    insertReturning.mockResolvedValue([runningRow({ status: 'pending' })]);
    batchV1.createNamespacedJob.mockRejectedValue(clusterError(403));

    await expect(service.start(storageClassId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(lastState(set)).toMatchObject({ status: 'failed' });
    expect(coreV1.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalled();
  });
});

describe('StorageBenchmarkService.poll', () => {
  it('keeps polling while the Job runs', async () => {
    const { service, batchV1, set } = createService([runningRow()]);

    batchV1.readNamespacedJob.mockResolvedValue({ status: { active: 1 } });

    await expect(service.poll(benchmarkId)).resolves.toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it('stores results and removes the Job, claim and volume', async () => {
    const { service, batchV1, coreV1, set } = createService([runningRow()]);

    batchV1.readNamespacedJob.mockResolvedValue({ status: { succeeded: 1 } });
    coreV1.readNamespacedPodLog.mockResolvedValue(
      `${FIO_JSON_BEGIN}\n${report}\n${FIO_JSON_END}`,
    );

    await expect(service.poll(benchmarkId)).resolves.toBe(true);

    expect(lastState(set)).toMatchObject({
      status: 'succeeded',
      results: { random_read_iops: 100, random_write_iops: 50 },
    });
    // Retain profiles must not keep the test data: the volume is switched to
    // Delete before its claim goes.
    expect(coreV1.patchPersistentVolume).toHaveBeenCalledWith({
      name: 'pvc-123',
      body: [
        {
          op: 'replace',
          path: '/spec/persistentVolumeReclaimPolicy',
          value: 'Delete',
        },
      ],
    });
    expect(batchV1.deleteNamespacedJob).toHaveBeenCalledWith({
      name,
      namespace,
      propagationPolicy: 'Background',
    });
    expect(coreV1.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalledWith({
      name,
      namespace,
    });
  });

  it('records the script error of a failed Job', async () => {
    const { service, batchV1, coreV1, set } = createService([runningRow()]);

    batchV1.readNamespacedJob.mockResolvedValue({ status: { failed: 1 } });
    coreV1.readNamespacedPodLog.mockResolvedValue(
      'BENCHMARK_ERROR: Could not install fio.',
    );

    await expect(service.poll(benchmarkId)).resolves.toBe(true);
    expect(lastState(set)).toMatchObject({
      status: 'failed',
      status_message: 'Could not install fio.',
    });
  });

  it('explains a deadline without a log', async () => {
    const { service, batchV1, coreV1, set } = createService([runningRow()]);

    batchV1.readNamespacedJob.mockResolvedValue({
      status: {
        conditions: [
          { type: 'Failed', status: 'True', reason: 'DeadlineExceeded' },
        ],
      },
    });
    coreV1.listNamespacedPod.mockResolvedValue({ items: [] });

    await service.poll(benchmarkId);

    expect(lastState(set).status_message).toMatch(/did not finish in time/);
  });

  it('fails a run whose Job disappeared', async () => {
    const { service, batchV1, set } = createService([runningRow()]);

    batchV1.readNamespacedJob.mockRejectedValue(clusterError(404));

    await expect(service.poll(benchmarkId)).resolves.toBe(true);
    expect(lastState(set)).toMatchObject({ status: 'failed' });
  });

  it('gives up on a stale run but tolerates a brief outage', async () => {
    const fresh = createService([runningRow()]);

    fresh.batchV1.readNamespacedJob.mockRejectedValue(new Error('ECONNRESET'));
    await expect(fresh.service.poll(benchmarkId)).resolves.toBe(false);

    const stale = createService([
      runningRow({ started_at: new Date(Date.now() - 60 * 60 * 1000) }),
    ]);

    stale.batchV1.readNamespacedJob.mockResolvedValue({ status: {} });
    await expect(stale.service.poll(benchmarkId)).resolves.toBe(true);
    expect(lastState(stale.set)).toMatchObject({
      status: 'failed',
      status_message: 'The benchmark timed out',
    });
  });

  it('ignores finished runs', async () => {
    const { service, batchV1 } = createService([
      runningRow({ status: 'succeeded' }),
    ]);

    await expect(service.poll(benchmarkId)).resolves.toBe(true);
    expect(batchV1.readNamespacedJob).not.toHaveBeenCalled();
  });
});
