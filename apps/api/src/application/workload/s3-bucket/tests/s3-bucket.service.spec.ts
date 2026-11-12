import { BadRequestException, ConflictException } from '@nestjs/common';
import type { V1Job } from '@kubernetes/client-node';
import type { ProjectIsolationService } from '@/application/project/project-isolation.service';
import type { ProjectService } from '@/application/project/project.service';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadEventsService } from '../../observer/workload-events.service';
import type { WorkloadRow } from '../../schemas/workload.schema';
import type { WorkloadVersionService } from '../../workload-version.service';
import { BUCKET_WORKLOAD_LABEL } from '../s3-bucket.manifests';
import {
  BUCKET_TAKEN_MESSAGE,
  bucketErrorFromLog,
  generateBucketKeys,
  LOCKED_BUCKET_MESSAGE,
  S3BucketWorkloadService,
  UNSUPPORTED_ACTION_MESSAGE,
} from '../s3-bucket.service';

// These pull the ESM-only Kubernetes client; the service only needs the
// classes for dependency injection, and every instance is faked.
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
const namespace = `project-${projectId}`;

const row = (overrides: Partial<WorkloadRow> = {}): WorkloadRow => ({
  id: workloadId,
  auto_deploy: true,
  project_id: projectId,
  name: 'demo-assets',
  type: 's3_bucket',
  active_version_id: null,
  draft_config: null,
  position: { x: 0, y: 0 },
  external_name: 'demo-assets',
  internal_hostname: null,
  storage_class_id: null,
  last_deployed_at: new Date('2026-11-04T10:00:00.000Z'),
  icon: null,
  created_at: new Date('2026-11-04T10:00:00.000Z'),
  updated_at: new Date('2026-11-04T10:00:00.000Z'),
  ...overrides,
});

/**
 * A query builder whose every step returns itself and which resolves, when
 * awaited, to the next queued result for its kind of statement.
 */
const createDatabase = () => {
  const results = {
    select: [] as unknown[][],
    insert: [] as (unknown[] | Error)[],
    update: [] as unknown[][],
  };
  const calls = {
    insertValues: [] as unknown[],
    updateSet: [] as unknown[],
    deletes: 0,
  };
  const chain = (resolve: () => unknown) => {
    const query: Record<string, unknown> = {};

    for (const step of ['from', 'where', 'limit', 'orderBy', 'returning']) {
      query[step] = jest.fn(() => query);
    }

    query.values = jest.fn((values: unknown) => {
      calls.insertValues.push(values);
      return query;
    });
    query.set = jest.fn((values: unknown) => {
      calls.updateSet.push(values);
      return query;
    });
    query.then = (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => {
      try {
        const value = resolve();

        return (
          value instanceof Error
            ? Promise.reject(value)
            : Promise.resolve(value)
        ).then(onFulfilled, onRejected);
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        ).then(onFulfilled, onRejected);
      }
    };

    return query;
  };
  const db = {
    select: jest.fn(() => chain(() => results.select.shift() ?? [])),
    insert: jest.fn(() => chain(() => results.insert.shift() ?? [])),
    update: jest.fn(() => chain(() => results.update.shift() ?? [])),
    delete: jest.fn(() =>
      chain(() => {
        calls.deletes += 1;
        return [];
      }),
    ),
  };

  return { db: db as unknown as Database, results, calls };
};

const job = (status: V1Job['status'] = {}): V1Job => ({
  metadata: { name: `s3-create-${workloadId}`, uid: 'job-uid' },
  status,
});

/** A Secret without a phase is one written before phases existed: ready. */
const projectSecret = (phase?: string, message?: string) => ({
  metadata: {
    name: 's3-demo-assets',
    namespace,
    labels: { [BUCKET_WORKLOAD_LABEL]: workloadId },
    ...(phase === undefined
      ? {}
      : {
          annotations: {
            'acceleratio.io/bucket-phase': phase,
            ...(message === undefined
              ? {}
              : { 'acceleratio.io/bucket-message': message }),
          },
        }),
  },
  data: {
    AWS_ACCESS_KEY_ID: Buffer.from('ACKEY').toString('base64'),
    AWS_SECRET_ACCESS_KEY: Buffer.from('SECRET').toString('base64'),
    AWS_ENDPOINT_URL: Buffer.from('http://s3:9000').toString('base64'),
    AWS_REGION: Buffer.from('us-east-1').toString('base64'),
  },
});

const notFound = () => Object.assign(new Error('not found'), { code: 404 });

const createService = () => {
  const database = createDatabase();
  const coreV1 = {
    createNamespacedSecret: jest.fn().mockResolvedValue({}),
    replaceNamespacedSecret: jest
      .fn()
      .mockImplementation(({ body }: { body: unknown }) =>
        Promise.resolve(body),
      ),
    deleteNamespacedSecret: jest.fn().mockResolvedValue({}),
    readNamespacedSecret: jest.fn().mockResolvedValue(projectSecret()),
    listNamespacedSecret: jest.fn().mockResolvedValue({ items: [] }),
    listNamespacedPod: jest
      .fn()
      .mockResolvedValue({ items: [{ metadata: { name: 'pod-1' } }] }),
    readNamespacedPodLog: jest.fn().mockResolvedValue(''),
  };
  const batchV1 = {
    createNamespacedJob: jest.fn().mockResolvedValue(job()),
    readNamespacedJob: jest.fn().mockRejectedValue(notFound()),
    deleteNamespacedJob: jest.fn().mockRejectedValue(notFound()),
  };
  const kubernetes = { coreV1, batchV1 } as unknown as KubernetesService;
  const projectService = {
    exists: jest.fn().mockResolvedValue(true),
  } as unknown as ProjectService;
  const ensureIsolation = jest.fn().mockResolvedValue(undefined);
  const isolation = {
    ensure: ensureIsolation,
  } as unknown as ProjectIsolationService;
  const events = { publish: jest.fn() };
  const versions = {
    record: jest.fn().mockResolvedValue({}),
    findByIds: jest.fn().mockResolvedValue(new Map()),
    list: jest.fn().mockResolvedValue([]),
  };
  const service = new S3BucketWorkloadService(
    database.db,
    projectService,
    isolation,
    kubernetes,
    events as unknown as WorkloadEventsService,
    versions as unknown as WorkloadVersionService,
  );

  return {
    service,
    ...database,
    coreV1,
    batchV1,
    events,
    versions,
    ensureIsolation,
  };
};

/** The private poll step, without timers. */
const checkCreate = (service: S3BucketWorkloadService, startedAt: number) =>
  (
    service as unknown as {
      checkCreate(id: string, startedAt: number): Promise<boolean>;
    }
  ).checkCreate(workloadId, startedAt);

afterEach(() => jest.useRealTimers());

describe('S3BucketWorkloadService.create', () => {
  it('records the bucket, writes the keys and starts the create Job', async () => {
    const context = createService();
    const { service, results, calls, coreV1, batchV1 } = context;

    results.select.push([], [row()]);
    results.insert.push([row()]);
    coreV1.readNamespacedSecret.mockResolvedValue(
      projectSecret('provisioning'),
    );

    const created = await service.create(projectId, {
      name: ' demo-assets ',
      type: 's3_bucket',
    });

    service.onModuleDestroy();

    expect(calls.insertValues[0]).toMatchObject({
      name: 'demo-assets',
      type: 's3_bucket',
      external_name: 'demo-assets',
    });
    expect(calls.insertValues[0]).not.toHaveProperty('status');
    const [[recorded]] = context.versions.record.mock.calls as [
      [{ workloadId: string; config: unknown }],
    ];

    expect(recorded.config).toEqual({});
    expect(context.ensureIsolation).toHaveBeenCalledWith(projectId);

    const [projectCall, jobSecretCall] = coreV1.createNamespacedSecret.mock
      .calls as [{ namespace: string; body: { metadata: unknown } }][];

    expect(projectCall[0]).toMatchObject({
      namespace,
      body: {
        metadata: {
          name: 's3-demo-assets',
          namespace,
          annotations: { 'acceleratio.io/bucket-phase': 'provisioning' },
        },
      },
    });
    expect(jobSecretCall[0]).toMatchObject({
      namespace: 'rustfs',
      body: {
        metadata: {
          ownerReferences: [expect.objectContaining({ uid: 'job-uid' })],
        },
      },
    });
    expect(batchV1.createNamespacedJob).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'rustfs' }),
    );
    expect(created).toMatchObject({
      type: 's3_bucket',
      status: 'deploying',
      draft_config: null,
      s3: {
        bucket: 'demo-assets',
        endpoint: 'http://s3:9000',
        access_key_id: 'ACKEY',
        secret_name: 's3-demo-assets',
      },
    });
    expect(created.s3).not.toHaveProperty('secret_access_key');
  });

  it('rejects a name another bucket already uses', async () => {
    const { service, results, batchV1 } = createService();

    results.insert.push(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );

    await expect(
      service.create(projectId, { name: 'demo-assets', type: 's3_bucket' }),
    ).rejects.toThrow(new ConflictException(BUCKET_TAKEN_MESSAGE));
    expect(batchV1.createNamespacedJob).not.toHaveBeenCalled();
  });

  it('rejects bucket settings', async () => {
    const { service, results } = createService();

    results.select.push([]);

    await expect(
      service.create(projectId, {
        name: 'demo-assets',
        type: 's3_bucket',
        config: { versioning: true } as never,
      }),
    ).rejects.toThrow('Unknown bucket setting: versioning');
  });

  it('removes the row again when the cluster refuses the Job', async () => {
    const { service, results, calls, batchV1 } = createService();

    results.insert.push([row()]);
    batchV1.createNamespacedJob.mockRejectedValue(
      Object.assign(new Error('forbidden'), { code: 403 }),
    );

    await expect(
      service.create(projectId, { name: 'demo-assets', type: 's3_bucket' }),
    ).rejects.toBeDefined();
    expect(calls.deletes).toBe(1);
  });

  it('validates the bucket name before touching anything', async () => {
    const { service, calls, batchV1 } = createService();

    await expect(
      service.create(projectId, { name: 'Demo_Assets', type: 's3_bucket' }),
    ).rejects.toThrow(BadRequestException);
    expect(calls.insertValues).toHaveLength(0);
    expect(batchV1.createNamespacedJob).not.toHaveBeenCalled();
  });
});

describe('S3BucketWorkloadService provisioning poll', () => {
  const provisioning = (context: ReturnType<typeof createService>) => {
    context.results.select.push([row()]);
    context.coreV1.readNamespacedSecret.mockResolvedValue(
      projectSecret('provisioning'),
    );
  };

  const writtenAnnotations = (coreV1: { replaceNamespacedSecret: jest.Mock }) =>
    (
      (coreV1.replaceNamespacedSecret.mock.calls as unknown[][])[0][0] as {
        body: { metadata: { annotations: Record<string, string> } };
      }
    ).body.metadata.annotations;

  it('marks the bucket ready on its Secret when the Job succeeds', async () => {
    const context = createService();
    const { service, batchV1, events, coreV1, results } = context;

    provisioning(context);
    batchV1.readNamespacedJob.mockResolvedValue(job({ succeeded: 1 }));

    await expect(checkCreate(service, Date.now())).resolves.toBe(true);
    expect(writtenAnnotations(coreV1)).toEqual({
      'acceleratio.io/bucket-phase': 'ready',
    });
    expect(results.update).toHaveLength(0);
    expect(context.calls.updateSet).toHaveLength(0);
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', status: 'running' }),
    );
  });

  it('marks the bucket failed with the error the Job logged', async () => {
    const context = createService();
    const { service, batchV1, coreV1, events } = context;

    provisioning(context);
    batchV1.readNamespacedJob.mockResolvedValue(job({ failed: 1 }));
    coreV1.readNamespacedPodLog.mockResolvedValue(
      'BUCKET_ERROR bucket demo-assets already exists\n',
    );

    await checkCreate(service, Date.now());

    expect(writtenAnnotations(coreV1)).toEqual({
      'acceleratio.io/bucket-phase': 'failed',
      'acceleratio.io/bucket-message': 'bucket demo-assets already exists',
    });
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        status_message: 'bucket demo-assets already exists',
      }),
    );
  });

  it('keeps polling while the Job runs', async () => {
    const context = createService();

    provisioning(context);
    context.batchV1.readNamespacedJob.mockResolvedValue(job({ active: 1 }));

    await expect(checkCreate(context.service, Date.now())).resolves.toBe(false);
    expect(context.coreV1.replaceNamespacedSecret).not.toHaveBeenCalled();
  });

  it('gives up on a Job that never finishes', async () => {
    const context = createService();

    provisioning(context);
    context.batchV1.readNamespacedJob.mockResolvedValue(job({ active: 1 }));

    await checkCreate(context.service, Date.now() - 60 * 60 * 1000);

    expect(writtenAnnotations(context.coreV1)).toEqual({
      'acceleratio.io/bucket-phase': 'failed',
      'acceleratio.io/bucket-message':
        'Object storage did not create the bucket in time',
    });
  });

  it('stops once the bucket is no longer provisioning', async () => {
    const { service, results, batchV1, coreV1 } = createService();

    results.select.push([row()]);
    coreV1.readNamespacedSecret.mockResolvedValue(projectSecret('ready'));

    await expect(checkCreate(service, Date.now())).resolves.toBe(true);
    expect(batchV1.readNamespacedJob).not.toHaveBeenCalled();
  });

  it('follows buckets that were still provisioning when the API stopped', async () => {
    const { service, results, coreV1 } = createService();
    const pending = {
      ...projectSecret('provisioning'),
      metadata: {
        ...projectSecret('provisioning').metadata,
        creationTimestamp: new Date(),
      },
    };

    results.select.push([{ id: workloadId, project_id: projectId }]);
    coreV1.listNamespacedSecret.mockResolvedValue({ items: [pending] });

    await service.onModuleInit();

    const timers = (service as unknown as { timers: Map<string, unknown> })
      .timers;

    expect(timers.has(workloadId)).toBe(true);
    service.onModuleDestroy();
  });
});

describe('S3BucketWorkloadService status', () => {
  it.each([
    ['provisioning', undefined, 'deploying', null],
    ['ready', undefined, 'running', null],
    ['failed', 'filer down', 'failed', 'filer down'],
    [undefined, undefined, 'running', null],
  ])(
    'reads the %s phase from the Secret',
    async (phase, message, expected, expectedMessage) => {
      const { service, results, coreV1 } = createService();

      results.select.push([row()]);
      coreV1.readNamespacedSecret.mockResolvedValue(
        projectSecret(phase, message),
      );

      await expect(service.get(projectId, workloadId)).resolves.toMatchObject({
        status: expected,
        status_message: expectedMessage,
      });
    },
  );

  it('reports a bucket whose Secret is gone as failed', async () => {
    const { service, results, coreV1 } = createService();

    results.select.push([row()]);
    coreV1.readNamespacedSecret.mockRejectedValue(notFound());

    await expect(service.get(projectId, workloadId)).resolves.toMatchObject({
      status: 'failed',
    });
  });
});

describe('S3BucketWorkloadService.remove', () => {
  it('runs the delete Job, then removes the keys and the row', async () => {
    const { service, results, calls, batchV1, coreV1 } = createService();

    results.select.push([row()]);
    batchV1.readNamespacedJob
      // The stale-Job check finds nothing, then the new Job has finished.
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue(job({ succeeded: 1 }));

    await service.remove(projectId, workloadId);

    const [[started]] = batchV1.createNamespacedJob.mock.calls as [
      [{ body: V1Job }],
    ];

    expect(started.body.metadata?.name).toBe(`s3-delete-${workloadId}`);
    expect(coreV1.deleteNamespacedSecret).toHaveBeenCalledWith({
      name: 's3-demo-assets',
      namespace,
    });
    expect(calls.deletes).toBe(1);
  });

  it('keeps the row when RustFS reports an error', async () => {
    const { service, results, calls, batchV1, coreV1 } = createService();

    results.select.push([row()]);
    batchV1.readNamespacedJob
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue(job({ failed: 1 }));
    coreV1.readNamespacedPodLog.mockResolvedValue(
      'BUCKET_ERROR rustfs unavailable',
    );

    await expect(service.remove(projectId, workloadId)).rejects.toThrow(
      'Could not delete the bucket: rustfs unavailable',
    );
    expect(calls.deletes).toBe(0);
  });
});

describe('S3BucketWorkloadService locked and unsupported actions', () => {
  it('refuses a rename or new settings', async () => {
    const { service, results } = createService();

    results.select.push([row()], [row()]);

    await expect(
      service.update(projectId, workloadId, { name: 'other-name' }),
    ).rejects.toThrow(LOCKED_BUCKET_MESSAGE);
    await expect(
      service.update(projectId, workloadId, {
        config: {},
      }),
    ).rejects.toThrow(LOCKED_BUCKET_MESSAGE);
  });

  it('moves the card on the canvas', async () => {
    const { service, results, calls, events } = createService();

    results.select.push([row()], [row({ position: { x: 10, y: 20 } })]);
    results.update.push([row({ position: { x: 10, y: 20 } })]);

    await service.update(projectId, workloadId, {
      position: { x: 10, y: 20 },
    });

    expect(calls.updateSet[0]).toEqual({ position: { x: 10, y: 20 } });
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'position' }),
    );
  });

  it.each(['deploy', 'start', 'stop', 'restart', 'rollback', 'discardDraft'])(
    'rejects %s',
    async (action) => {
      const { service } = createService();
      const run = (
        service as unknown as Record<string, () => Promise<unknown>>
      )[action].bind(service);

      await expect(run()).rejects.toThrow(UNSUPPORTED_ACTION_MESSAGE);
    },
  );
});

describe('S3BucketWorkloadService.rotateCredentials', () => {
  const rotateJob = (status: V1Job['status']): V1Job => ({
    metadata: { name: `s3-rotate-${workloadId}`, uid: 'rotate-uid' },
    status,
  });

  it('saves the new keys only after RustFS takes them', async () => {
    const { service, results, coreV1, batchV1 } = createService();

    // findRow for the rotation, then for the credentials it returns.
    results.select.push([row()], [row()]);
    batchV1.createNamespacedJob.mockResolvedValue(rotateJob({}));
    batchV1.readNamespacedJob
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue(rotateJob({ succeeded: 1 }));
    batchV1.deleteNamespacedJob.mockRejectedValue(notFound());

    const credentials = await service.rotateCredentials(projectId, workloadId);

    const [[started]] = batchV1.createNamespacedJob.mock.calls as [
      [{ body: V1Job }],
    ];
    const secretCalls = coreV1.createNamespacedSecret.mock.calls as [
      {
        namespace: string;
        body: {
          metadata: { name: string };
          stringData: Record<string, string>;
        };
      },
    ][];
    const [jobSecret, projectCopy] = secretCalls.map(([call]) => call);

    expect(started.body.metadata?.name).toBe(`s3-rotate-${workloadId}`);
    expect(jobSecret.body.metadata.name).toBe(`s3-rotate-${workloadId}`);
    expect(projectCopy).toMatchObject({
      namespace,
      body: { metadata: { name: 's3-demo-assets' } },
    });
    expect(projectCopy.body.stringData.AWS_ACCESS_KEY_ID).toBe(
      jobSecret.body.stringData.S3_ACCESS_KEY,
    );
    expect(credentials.secret_access_key).toBe('SECRET');
  });

  it('keeps the old Secret when RustFS refuses', async () => {
    const { service, results, coreV1, batchV1 } = createService();

    results.select.push([row()]);
    batchV1.createNamespacedJob.mockResolvedValue(rotateJob({}));
    batchV1.readNamespacedJob
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue(rotateJob({ failed: 1 }));
    coreV1.readNamespacedPodLog.mockResolvedValue('BUCKET_ERROR filer down');

    await expect(
      service.rotateCredentials(projectId, workloadId),
    ).rejects.toThrow('Could not regenerate the keys: filer down');
    // Only the Job's own Secret was written.
    expect(coreV1.createNamespacedSecret).toHaveBeenCalledTimes(1);
    expect(coreV1.replaceNamespacedSecret).not.toHaveBeenCalled();
  });

  it('waits until the bucket is ready', async () => {
    const { service, results, batchV1, coreV1 } = createService();

    results.select.push([row()]);
    coreV1.readNamespacedSecret.mockResolvedValue(
      projectSecret('provisioning'),
    );

    await expect(
      service.rotateCredentials(projectId, workloadId),
    ).rejects.toThrow('Keys can be regenerated once the bucket is ready');
    expect(batchV1.createNamespacedJob).not.toHaveBeenCalled();
  });
});

describe('S3BucketWorkloadService.readyBucket', () => {
  it('returns the name of a ready bucket and refuses others', async () => {
    const { service, results, coreV1 } = createService();

    results.select.push([row()], [row()]);
    coreV1.readNamespacedSecret
      .mockResolvedValueOnce(projectSecret('ready'))
      .mockResolvedValueOnce(projectSecret('provisioning'));

    await expect(service.readyBucket(projectId, workloadId)).resolves.toBe(
      'demo-assets',
    );
    await expect(service.readyBucket(projectId, workloadId)).rejects.toThrow(
      'The bucket is still being created',
    );
  });
});

describe('S3BucketWorkloadService.credentials', () => {
  it('returns the secret key from the project Secret', async () => {
    const { service, results } = createService();

    results.select.push([row()]);

    await expect(service.credentials(projectId, workloadId)).resolves.toEqual({
      bucket: 'demo-assets',
      endpoint: 'http://s3:9000',
      region: 'us-east-1',
      access_key_id: 'ACKEY',
      secret_access_key: 'SECRET',
      secret_name: 's3-demo-assets',
    });
  });

  it('ignores a Secret of that name the bucket did not write', async () => {
    const { service, results, coreV1 } = createService();

    results.select.push([row()]);
    coreV1.readNamespacedSecret.mockResolvedValue({
      ...projectSecret(),
      metadata: { name: 's3-demo-assets', labels: {} },
    });

    await expect(service.credentials(projectId, workloadId)).rejects.toThrow(
      'Bucket keys not found in the cluster',
    );
  });
});

describe('helpers', () => {
  it('generates AWS-shaped keys', () => {
    const keys = generateBucketKeys();

    expect(keys.accessKeyId).toMatch(/^AC[A-Z0-9]{18}$/);
    expect(keys.secretAccessKey).toMatch(/^[A-Za-z0-9_-]{40}$/);
    expect(generateBucketKeys().accessKeyId).not.toBe(keys.accessKeyId);
  });

  it('reads the last error line of a Job log', () => {
    expect(
      bucketErrorFromLog('noise\nBUCKET_ERROR first\nBUCKET_ERROR second\n'),
    ).toBe('second');
    expect(bucketErrorFromLog(null)).toBe(
      'Object storage did not finish the bucket operation',
    );
  });
});
