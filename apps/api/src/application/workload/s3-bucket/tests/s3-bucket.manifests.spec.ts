import {
  ACCESS_KEY_ENV,
  BUCKET_WORKLOAD_LABEL,
  bucketCommands,
  buildBucketJob,
  buildBucketScript,
  buildJobSecret,
  buildProjectSecret,
  SECRET_KEY_ENV,
  type BucketJobInput,
} from '../s3-bucket.manifests';
import { WORKLOAD_ID_LABEL } from '../../docker/docker-workload.manifests';

const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const keys = {
  accessKeyId: 'ACABCDEFGHIJKLMNOPQR',
  secretAccessKey: 'super-secret-value-that-must-not-leak-00',
};

const input = (overrides: Partial<BucketJobInput> = {}): BucketJobInput => ({
  workloadId,
  projectId,
  bucket: 'demo-assets',
  operation: 'create',
  parameters: { replication: '001', disk_type: null, ttl: null },
  target: {
    namespace: 'seaweedfs',
    master: 'seaweedfs-master.seaweedfs:9333',
    filer: 'seaweedfs-filer.seaweedfs:8888',
    image: 'chrislusf/seaweedfs:4.51',
  },
  ...overrides,
});

describe('bucketCommands', () => {
  it('creates the bucket, its storage rule and its identity in order', () => {
    expect(bucketCommands(input()).map(({ command }) => command)).toEqual([
      's3.bucket.create -name demo-assets',
      'fs.configure -locationPrefix=/buckets/demo-assets/ -replication=001 -apply',
      `s3.configure -user=acc-${workloadId} -access_key=$S3_ACCESS_KEY -secret_key=$S3_SECRET_KEY -buckets=demo-assets -actions=Read,Write,List,Tagging -apply`,
    ]);
  });

  it('on a retried setup, keeps the bucket and replaces the identity keys', () => {
    const commands = bucketCommands(input({ tolerateExisting: true }));

    expect(commands[0]).toEqual({
      command: 's3.bucket.create -name demo-assets',
      tolerate: 'already exist',
    });
    expect(commands.map(({ command }) => command).slice(2)).toEqual([
      `s3.configure -user=acc-${workloadId} -delete -apply`,
      `s3.configure -user=acc-${workloadId} -access_key=$S3_ACCESS_KEY -secret_key=$S3_SECRET_KEY -buckets=demo-assets -actions=Read,Write,List,Tagging -apply`,
    ]);
  });

  it('adds disk type and TTL only when the profile sets them', () => {
    const [, rule] = bucketCommands(
      input({
        parameters: { replication: '000', disk_type: 'ssd', ttl: '7d' },
      }),
    );

    expect(rule.command).toBe(
      'fs.configure -locationPrefix=/buckets/demo-assets/ -replication=000 -disk=ssd -ttl=7d -apply',
    );
  });

  it('deletes identity, rule and bucket, tolerating parts already gone', () => {
    expect(bucketCommands(input({ operation: 'delete' }))).toEqual([
      {
        command: `s3.configure -user=acc-${workloadId} -delete -apply`,
        tolerate: 'not found',
      },
      {
        command:
          'fs.configure -locationPrefix=/buckets/demo-assets/ -delete -apply',
      },
      { command: 's3.bucket.delete -name demo-assets', tolerate: 'not found' },
    ]);
  });
});

describe('key rotation', () => {
  it('drops the identity with every old key, then registers the new pair', () => {
    expect(bucketCommands(input({ operation: 'rotate' }))).toEqual([
      {
        command: `s3.configure -user=acc-${workloadId} -delete -apply`,
        tolerate: 'not found',
      },
      {
        command: `s3.configure -user=acc-${workloadId} -access_key=$S3_ACCESS_KEY -secret_key=$S3_SECRET_KEY -buckets=demo-assets -actions=Read,Write,List,Tagging -apply`,
      },
    ]);
  });

  it('reads the new keys from its own Job Secret', () => {
    const job = buildBucketJob(input({ operation: 'rotate' }));
    const secret = buildJobSecret(input({ operation: 'rotate' }), keys, {
      name: job.metadata!.name!,
      uid: 'uid-2',
    });

    expect(job.metadata!.name).toBe(`s3-rotate-${workloadId}`);
    expect(job.spec!.template.spec!.containers[0].env).toEqual([
      expect.objectContaining({
        valueFrom: {
          secretKeyRef: {
            name: `s3-rotate-${workloadId}`,
            key: ACCESS_KEY_ENV,
          },
        },
      }),
      expect.objectContaining({
        valueFrom: {
          secretKeyRef: {
            name: `s3-rotate-${workloadId}`,
            key: SECRET_KEY_ENV,
          },
        },
      }),
    ]);
    expect(secret.metadata!.name).toBe(`s3-rotate-${workloadId}`);
  });
});

describe('buildBucketScript', () => {
  it('discards weed shell output and reports one error line', () => {
    const script = buildBucketScript(input());

    expect(script).toContain('out=$(printf "%s\\n" "$1" | $W 2>&1)');
    expect(script).toContain(
      'echo "BUCKET_ERROR ${msg:-weed shell exited with $rc}"',
    );
    expect(script).toContain(
      'W="weed shell -master=seaweedfs-master.seaweedfs:9333 -filer=seaweedfs-filer.seaweedfs:8888"',
    );
    expect(script).toContain('run "s3.bucket.create -name demo-assets"');
    expect(script).not.toContain(keys.secretAccessKey);
  });
});

describe('buildBucketJob', () => {
  it('runs once, in the SeaweedFS namespace, without the observer label', () => {
    const job = buildBucketJob(input());
    const pod = job.spec!.template.spec!;

    expect(job.metadata).toMatchObject({
      name: `s3-create-${workloadId}`,
      namespace: 'seaweedfs',
    });
    expect(job.spec).toMatchObject({ backoffLimit: 0 });
    expect(job.spec!.template.metadata!.labels).toMatchObject({
      [BUCKET_WORKLOAD_LABEL]: workloadId,
    });
    expect(job.spec!.template.metadata!.labels).not.toHaveProperty(
      WORKLOAD_ID_LABEL,
    );
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.containers[0].image).toBe('chrislusf/seaweedfs:4.51');
  });

  it('passes the keys only through Secret references', () => {
    const job = buildBucketJob(input());
    const container = job.spec!.template.spec!.containers[0];

    expect(container.env).toEqual([
      {
        name: ACCESS_KEY_ENV,
        valueFrom: {
          secretKeyRef: {
            name: `s3-create-${workloadId}`,
            key: ACCESS_KEY_ENV,
          },
        },
      },
      {
        name: SECRET_KEY_ENV,
        valueFrom: {
          secretKeyRef: {
            name: `s3-create-${workloadId}`,
            key: SECRET_KEY_ENV,
          },
        },
      },
    ]);
    expect(JSON.stringify(job)).not.toContain(keys.secretAccessKey);
  });

  it('needs no keys to delete', () => {
    const job = buildBucketJob(input({ operation: 'delete' }));

    expect(job.metadata!.name).toBe(`s3-delete-${workloadId}`);
    expect(job.spec!.template.spec!.containers[0].env).toEqual([]);
  });
});

describe('Secrets', () => {
  it('ties the Job Secret to its Job so they are deleted together', () => {
    const secret = buildJobSecret(input(), keys, { name: 'job', uid: 'uid-1' });

    expect(secret.metadata).toMatchObject({
      name: `s3-create-${workloadId}`,
      namespace: 'seaweedfs',
      ownerReferences: [
        { apiVersion: 'batch/v1', kind: 'Job', name: 'job', uid: 'uid-1' },
      ],
    });
    expect(secret.stringData).toEqual({
      [ACCESS_KEY_ENV]: keys.accessKeyId,
      [SECRET_KEY_ENV]: keys.secretAccessKey,
    });
  });

  it('stores the project copy under the names AWS SDKs read', () => {
    const secret = buildProjectSecret({
      workloadId,
      projectId,
      namespace: `project-${projectId}`,
      bucket: 'demo-assets',
      endpoint: 'http://s3:8333',
      keys,
      phase: 'provisioning',
    });

    expect(secret.metadata).toMatchObject({
      name: 's3-demo-assets',
      namespace: `project-${projectId}`,
      labels: { [BUCKET_WORKLOAD_LABEL]: workloadId },
    });
    expect(secret.stringData).toEqual({
      AWS_ACCESS_KEY_ID: keys.accessKeyId,
      AWS_SECRET_ACCESS_KEY: keys.secretAccessKey,
      AWS_ENDPOINT_URL: 'http://s3:8333',
      AWS_REGION: 'us-east-1',
      S3_BUCKET: 'demo-assets',
    });
  });
});
