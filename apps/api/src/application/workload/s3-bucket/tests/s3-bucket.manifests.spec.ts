import {
  ACCESS_KEY_ENV,
  BUCKET_WORKLOAD_LABEL,
  bucketCommands,
  bucketPolicy,
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
  target: {
    namespace: 'rustfs',
    endpoint: 'http://rustfs.rustfs.svc.cluster.local:9000',
    image: 'rustfs/rc:test',
    adminSecret: 'rustfs-root',
  },
  ...overrides,
});

const commandsOf = (value: BucketJobInput) =>
  bucketCommands(value).map(({ command }) => command);
const removeOthers: unknown = expect.stringContaining(
  `rc admin policy entities admin --policy acc-${workloadId} --json`,
);

describe('bucketCommands', () => {
  it('refuses an existing bucket, then creates it and a key attached to its policy', () => {
    expect(commandsOf(input())).toEqual([
      'if rc bucket list admin/demo-assets >/dev/null 2>&1; then echo "Bucket name is already taken"; exit 1; fi',
      'rc bucket create admin/demo-assets',
      'printf "%s" "$POLICY_JSON" > /tmp/policy.json',
      `rc admin policy create admin acc-${workloadId} /tmp/policy.json`,
      'rc admin user add admin "$S3_ACCESS_KEY" "$S3_SECRET_KEY"',
      `rc admin policy attach admin acc-${workloadId} --user "$S3_ACCESS_KEY"`,
      removeOthers,
    ]);
  });

  it('on a retried setup, keeps the bucket and replaces the keys', () => {
    const commands = commandsOf(input({ tolerateExisting: true }));

    expect(commands[0]).toBe('rc bucket create admin/demo-assets');
    expect(commands.at(-1)).toEqual(removeOthers);
  });

  it('removes every key but the new one', () => {
    const [last] = bucketCommands(input()).slice(-1);

    expect(last.command).toContain(
      '[ "$u" = "${S3_ACCESS_KEY:-}" ] || rc admin user rm admin "$u" || exit 1',
    );
    expect(last.tolerate).toBe('not found');
  });

  it('deletes keys, policy and bucket, tolerating parts already gone', () => {
    expect(bucketCommands(input({ operation: 'delete' }))).toEqual([
      { command: removeOthers, tolerate: 'not found' },
      {
        command: `rc admin policy rm admin acc-${workloadId}`,
        tolerate: 'not found',
      },
      {
        command: 'rc bucket remove --force admin/demo-assets',
        tolerate: 'not found',
      },
    ]);
  });

  it('never creates or removes the bucket of a prefix key', () => {
    const create = commandsOf(input({ prefix: `${workloadId}/` }));
    const remove = commandsOf(
      input({ prefix: `${workloadId}/`, operation: 'delete' }),
    );

    expect(create.join('\n')).not.toContain('rc bucket');
    expect(remove.join('\n')).not.toContain('rc bucket');
  });
});

describe('bucketPolicy', () => {
  it('grants read and write on the bucket only', () => {
    const policy = JSON.parse(bucketPolicy(input())) as {
      Statement: { Action: string[]; Resource: string[] }[];
    };

    expect(policy.Statement.map((item) => item.Resource)).toEqual([
      ['arn:aws:s3:::demo-assets'],
      ['arn:aws:s3:::demo-assets/*'],
    ]);
    expect(policy.Statement[1].Action).toContain('s3:PutObject');
  });

  it('grants read-only access under a prefix', () => {
    expect(
      JSON.parse(
        bucketPolicy(input({ bucket: 'acceleratio-sites', prefix: 'w1/' })),
      ),
    ).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:ListBucket'],
          Resource: ['arn:aws:s3:::acceleratio-sites'],
          Condition: { StringLike: { 's3:prefix': ['w1/*'] } },
        },
        {
          Effect: 'Allow',
          Action: ['s3:GetObject'],
          Resource: ['arn:aws:s3:::acceleratio-sites/w1/*'],
        },
      ],
    });
  });
});

describe('key rotation', () => {
  it('adds the new key and removes the others, without touching the bucket', () => {
    expect(commandsOf(input({ operation: 'rotate' }))).toEqual([
      'printf "%s" "$POLICY_JSON" > /tmp/policy.json',
      `rc admin policy create admin acc-${workloadId} /tmp/policy.json`,
      'rc admin user add admin "$S3_ACCESS_KEY" "$S3_SECRET_KEY"',
      `rc admin policy attach admin acc-${workloadId} --user "$S3_ACCESS_KEY"`,
      removeOthers,
    ]);
  });

  it('reads the new keys from its own Job Secret', () => {
    const job = buildBucketJob(input({ operation: 'rotate' }));
    const secret = buildJobSecret(input({ operation: 'rotate' }), keys, {
      name: job.metadata!.name!,
      uid: 'uid-2',
    });

    expect(job.metadata!.name).toBe(`s3-rotate-${workloadId}`);
    expect(job.spec!.template.spec!.containers[0].env).toEqual(
      expect.arrayContaining([
        {
          name: ACCESS_KEY_ENV,
          valueFrom: {
            secretKeyRef: {
              name: `s3-rotate-${workloadId}`,
              key: ACCESS_KEY_ENV,
            },
          },
        },
        {
          name: SECRET_KEY_ENV,
          valueFrom: {
            secretKeyRef: {
              name: `s3-rotate-${workloadId}`,
              key: SECRET_KEY_ENV,
            },
          },
        },
      ]),
    );
    expect(secret.metadata!.name).toBe(`s3-rotate-${workloadId}`);
  });
});

describe('buildBucketScript', () => {
  it('discards rc output, masks secrets and reports one error line', () => {
    const script = buildBucketScript(input());

    expect(script).toContain('out=$(eval "$1" 2>&1)');
    expect(script).toContain(
      'echo "BUCKET_ERROR $(mask "${msg:-rc exited with $rc}")"',
    );
    expect(script).toContain(
      `run 'rc alias set admin "$RUSTFS_ENDPOINT" "$RUSTFS_ACCESS_KEY" "$RUSTFS_SECRET_KEY" --bucket-lookup path'`,
    );
    expect(script).toContain(`run 'rc bucket create admin/demo-assets'`);
    expect(script).not.toContain(keys.secretAccessKey);
  });
});

describe('buildBucketJob', () => {
  it('runs once, in the RustFS namespace, without the observer label', () => {
    const job = buildBucketJob(input());
    const pod = job.spec!.template.spec!;

    expect(job.metadata).toMatchObject({
      name: `s3-create-${workloadId}`,
      namespace: 'rustfs',
    });
    expect(job.spec).toMatchObject({ backoffLimit: 0 });
    expect(job.spec!.template.metadata!.labels).toMatchObject({
      [BUCKET_WORKLOAD_LABEL]: workloadId,
    });
    expect(job.spec!.template.metadata!.labels).not.toHaveProperty(
      WORKLOAD_ID_LABEL,
    );
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.containers[0].image).toBe('rustfs/rc:test');
  });

  it('passes the keys only through Secret references', () => {
    const job = buildBucketJob(input());
    const env = job.spec!.template.spec!.containers[0].env!;

    expect(env.map((item) => item.name)).toEqual([
      'RUSTFS_ENDPOINT',
      'POLICY_JSON',
      'RUSTFS_ACCESS_KEY',
      'RUSTFS_SECRET_KEY',
      ACCESS_KEY_ENV,
      SECRET_KEY_ENV,
    ]);
    expect(env[2].valueFrom).toEqual({
      secretKeyRef: { name: 'rustfs-root', key: 'RUSTFS_ACCESS_KEY' },
    });
    expect(env[5].valueFrom).toEqual({
      secretKeyRef: { name: `s3-create-${workloadId}`, key: SECRET_KEY_ENV },
    });
    expect(JSON.stringify(job)).not.toContain(keys.secretAccessKey);
  });

  it('needs no bucket keys to delete', () => {
    const job = buildBucketJob(input({ operation: 'delete' }));

    expect(job.metadata!.name).toBe(`s3-delete-${workloadId}`);
    expect(
      job.spec!.template.spec!.containers[0].env!.map((item) => item.name),
    ).not.toContain(ACCESS_KEY_ENV);
  });
});

describe('Secrets', () => {
  it('ties the Job Secret to its Job so they are deleted together', () => {
    const secret = buildJobSecret(input(), keys, { name: 'job', uid: 'uid-1' });

    expect(secret.metadata).toMatchObject({
      name: `s3-create-${workloadId}`,
      namespace: 'rustfs',
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
      endpoint: 'http://s3:9000',
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
      AWS_ENDPOINT_URL: 'http://s3:9000',
      AWS_REGION: 'us-east-1',
      S3_BUCKET: 'demo-assets',
    });
  });
});
