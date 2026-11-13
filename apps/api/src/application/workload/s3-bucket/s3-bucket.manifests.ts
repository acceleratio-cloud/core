import type { V1Job, V1Secret } from '@kubernetes/client-node';
import { S3_REGION } from '@/vendor/s3/rustfs';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  PROJECT_ID_LABEL,
} from '../docker/docker-workload.manifests';

/**
 * Not `acceleratio.io/workload-id`: the workload observer selects pods by
 * that label, and a provisioning pod is not a pod of the bucket.
 */
export const BUCKET_WORKLOAD_LABEL = 'acceleratio.io/s3-bucket-workload-id';
export const BUCKET_OPERATION_LABEL = 'acceleratio.io/s3-bucket-operation';
/**
 * Where a bucket stands is kept on its project Secret, next to the keys it
 * describes, so the cluster holds the state and the database does not. A
 * Secret without the annotation predates it and belongs to a ready bucket.
 */
export const BUCKET_PHASE_ANNOTATION = 'acceleratio.io/bucket-phase';
export const BUCKET_MESSAGE_ANNOTATION = 'acceleratio.io/bucket-message';

export type BucketPhase = 'provisioning' | 'ready' | 'failed';

export const RC_CONTAINER = 'rc';
/** Matches RC_IMAGE in scripts/install.sh, which passes it as RUSTFS_RC_IMAGE. */
export const DEFAULT_RUSTFS_RC_IMAGE =
  'rustfs/rc:v0.1.37@sha256:7e93fd410a8fe51514f89373e093392c92095b98dc6140335fcfe956810c4c80';

/** Prefix of the one log line a failed Job leaves for the API. */
export const BUCKET_ERROR_PREFIX = 'BUCKET_ERROR';
export const ACTIVE_DEADLINE_SECONDS = 120;
export const TTL_AFTER_FINISHED_SECONDS = 600;

export const ACCESS_KEY_ENV = 'S3_ACCESS_KEY';
export const SECRET_KEY_ENV = 'S3_SECRET_KEY';
const ADMIN_ACCESS_KEY_ENV = 'RUSTFS_ACCESS_KEY';
const ADMIN_SECRET_KEY_ENV = 'RUSTFS_SECRET_KEY';
const ENDPOINT_ENV = 'RUSTFS_ENDPOINT';
const POLICY_ENV = 'POLICY_JSON';

export type BucketOperation = 'create' | 'rotate' | 'delete';

/** Operations whose Job registers new keys and so reads them from a Secret. */
export const operationNeedsKeys = (operation: BucketOperation): boolean =>
  operation !== 'delete';

/** Where the `rc` Jobs run and what they connect to. */
export interface RustfsTarget {
  namespace: string;
  /** S3 endpoint as pods reach it. */
  endpoint: string;
  image: string;
  /** Secret with the admin keys, in `namespace`. */
  adminSecret: string;
}

export interface BucketJobInput {
  workloadId: string;
  projectId: string;
  bucket: string;
  operation: BucketOperation;
  /**
   * Read-only access to the objects under `<bucket>/<prefix>` instead of the
   * whole bucket (static sites). The bucket is then the platform's: the Job
   * never creates or removes it.
   */
  prefix?: string;
  target: RustfsTarget;
  /**
   * `create` succeeds when the bucket already exists (a retried setup of a
   * bucket the platform names itself). Without it an existing bucket fails
   * the create: a user must never get keys to a bucket that is not theirs.
   */
  tolerateExisting?: boolean;
}

/** The IAM policy the workload's keys are attached to. */
export const bucketPolicyName = (workloadId: string): string =>
  `acc-${workloadId}`;

export const bucketJobName = (
  workloadId: string,
  operation: BucketOperation,
): string => `s3-${operation}-${workloadId}`;

/** Holds the keys while a create or rotate Job runs; owned by that Job. */
export const jobSecretName = (
  workloadId: string,
  operation: BucketOperation,
): string => `s3-${operation}-${workloadId}`;

/** The lasting copy of the keys, next to the project's workloads. */
export const projectSecretName = (bucket: string): string => `s3-${bucket}`;

/**
 * Read and write on one bucket, or read-only on one prefix of it. Bucket
 * names and prefixes are validated before they get here (lowercase letters,
 * digits, hyphens, and a UUID), so they need no JSON escaping.
 */
export const bucketPolicy = (
  input: Pick<BucketJobInput, 'bucket' | 'prefix'>,
): string => {
  const arn = `arn:aws:s3:::${input.bucket}`;

  if (input.prefix !== undefined) {
    return JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:ListBucket'],
          Resource: [arn],
          Condition: { StringLike: { 's3:prefix': [`${input.prefix}*`] } },
        },
        {
          Effect: 'Allow',
          Action: ['s3:GetObject'],
          Resource: [`${arn}/${input.prefix}*`],
        },
      ],
    });
  }

  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          's3:ListBucket',
          's3:GetBucketLocation',
          's3:ListBucketMultipartUploads',
        ],
        Resource: [arn],
      },
      {
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
          's3:ListMultipartUploadParts',
          's3:GetObjectTagging',
          's3:PutObjectTagging',
          's3:DeleteObjectTagging',
        ],
        Resource: [`${arn}/*`],
      },
    ],
  });
};

/**
 * One `rc` command line per step, each run through `eval`. Names are
 * validated before they get here, and the keys are never part of this text:
 * the shell expands them from the container environment. A user is the
 * access key itself, so replacing keys means adding the new user and
 * removing every other user attached to the workload's policy.
 */
export const bucketCommands = (
  input: Pick<
    BucketJobInput,
    'workloadId' | 'bucket' | 'operation' | 'prefix' | 'tolerateExisting'
  >,
): { command: string; tolerate?: string }[] => {
  const policy = bucketPolicyName(input.workloadId);
  const owned = input.prefix === undefined;
  const removeOtherUsers = {
    command: [
      `users=$(rc admin policy entities admin --policy ${policy} --json) || exit 1;`,
      'for u in $(printf "%s" "$users" | jq -r ".data.policy_mappings[]?.users[]?");',
      `do [ "$u" = "\${${ACCESS_KEY_ENV}:-}" ] || rc admin user rm admin "$u" || exit 1; done`,
    ].join(' '),
    tolerate: 'not found',
  };

  if (input.operation === 'delete') {
    // Each step tolerates "already gone", so a retried delete converges.
    return [
      removeOtherUsers,
      { command: `rc admin policy rm admin ${policy}`, tolerate: 'not found' },
      ...(owned
        ? [
            {
              command: `rc bucket remove --force admin/${input.bucket}`,
              tolerate: 'not found',
            },
          ]
        : []),
    ];
  }

  return [
    ...(owned && input.operation === 'create'
      ? [
          ...(input.tolerateExisting
            ? []
            : [
                {
                  command: `if rc bucket list admin/${input.bucket} >/dev/null 2>&1; then echo "Bucket name is already taken"; exit 1; fi`,
                },
              ]),
          { command: `rc bucket create admin/${input.bucket}` },
        ]
      : []),
    { command: `printf "%s" "$${POLICY_ENV}" > /tmp/policy.json` },
    { command: `rc admin policy create admin ${policy} /tmp/policy.json` },
    {
      command: `rc admin user add admin "$${ACCESS_KEY_ENV}" "$${SECRET_KEY_ENV}"`,
    },
    {
      command: `rc admin policy attach admin ${policy} --user "$${ACCESS_KEY_ENV}"`,
    },
    // Keys of an earlier attempt or of the rotation before stop working.
    removeOtherUsers,
  ];
};

/**
 * The shell script the Job runs. `rc` output is discarded: a failure leaves
 * exactly one `BUCKET_ERROR` line in the log, its last line of output with
 * any secret key masked.
 */
export const buildBucketScript = (input: BucketJobInput): string => {
  const lines = bucketCommands(input).map(({ command, tolerate }) =>
    tolerate ? `run '${command}' '${tolerate}'` : `run '${command}'`,
  );

  return [
    'set -u',
    'mask() {',
    '  out=$1',
    `  for k in "\${${ADMIN_SECRET_KEY_ENV}:-}" "\${${SECRET_KEY_ENV}:-}"; do`,
    '    [ -n "$k" ] && out=$(printf "%s" "$out" | sed "s|$k|***|g")',
    '  done',
    '  printf "%s" "$out"',
    '}',
    'run() {',
    '  out=$(eval "$1" 2>&1)',
    '  rc=$?',
    '  if [ "$rc" -eq 0 ]; then return 0; fi',
    '  if [ -n "${2:-}" ] && printf "%s" "$out" | grep -qi "$2"; then return 0; fi',
    '  msg=$(printf "%s\\n" "$out" | grep -v "^ *$" | tail -1 | sed "s/^✗ *//")',
    `  echo "${BUCKET_ERROR_PREFIX} $(mask "\${msg:-rc exited with $rc}")"`,
    '  exit 1',
    '}',
    `run 'rc alias set admin "$${ENDPOINT_ENV}" "$${ADMIN_ACCESS_KEY_ENV}" "$${ADMIN_SECRET_KEY_ENV}" --bucket-lookup path'`,
    ...lines,
    'echo "done"',
  ].join('\n');
};

const labels = (input: Pick<BucketJobInput, 'workloadId' | 'projectId'>) => ({
  [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  [PROJECT_ID_LABEL]: input.projectId,
  [BUCKET_WORKLOAD_LABEL]: input.workloadId,
});

export const buildBucketJob = (input: BucketJobInput): V1Job => {
  const jobLabels = {
    ...labels(input),
    [BUCKET_OPERATION_LABEL]: input.operation,
  };
  const fromSecret = (name: string, secret: string, key = name) => ({
    name,
    valueFrom: { secretKeyRef: { name: secret, key } },
  });
  const env = [
    { name: ENDPOINT_ENV, value: input.target.endpoint },
    { name: POLICY_ENV, value: bucketPolicy(input) },
    fromSecret(ADMIN_ACCESS_KEY_ENV, input.target.adminSecret),
    fromSecret(ADMIN_SECRET_KEY_ENV, input.target.adminSecret),
    ...(operationNeedsKeys(input.operation)
      ? [ACCESS_KEY_ENV, SECRET_KEY_ENV].map((name) =>
          fromSecret(name, jobSecretName(input.workloadId, input.operation)),
        )
      : []),
  ];

  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: bucketJobName(input.workloadId, input.operation),
      namespace: input.target.namespace,
      labels: jobLabels,
    },
    spec: {
      // One attempt: a create that half-ran would fail its retry on "bucket
      // name is already taken". The user deletes the failed bucket, which
      // cleans up.
      backoffLimit: 0,
      activeDeadlineSeconds: ACTIVE_DEADLINE_SECONDS,
      ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
      template: {
        metadata: { labels: jobLabels },
        spec: {
          restartPolicy: 'Never',
          automountServiceAccountToken: false,
          containers: [
            {
              name: RC_CONTAINER,
              image: input.target.image,
              command: ['sh', '-c', buildBucketScript(input)],
              env,
              resources: {
                requests: { cpu: '50m', memory: '64Mi' },
                limits: { cpu: '500m', memory: '256Mi' },
              },
            },
          ],
        },
      },
    },
  };
};

export interface BucketKeys {
  accessKeyId: string;
  secretAccessKey: string;
}

/** Keys for a create or rotate Job, deleted with it by owner reference. */
export const buildJobSecret = (
  input: Pick<
    BucketJobInput,
    'workloadId' | 'projectId' | 'target' | 'operation'
  >,
  keys: BucketKeys,
  owner: { name: string; uid: string },
): V1Secret => ({
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: {
    name: jobSecretName(input.workloadId, input.operation),
    namespace: input.target.namespace,
    labels: labels(input),
    ownerReferences: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        name: owner.name,
        uid: owner.uid,
        controller: true,
      },
    ],
  },
  type: 'Opaque',
  stringData: {
    [ACCESS_KEY_ENV]: keys.accessKeyId,
    [SECRET_KEY_ENV]: keys.secretAccessKey,
  },
});

/**
 * The keys in the project namespace, under the names AWS SDKs read, so a
 * workload can load the whole Secret as its environment.
 */
export const buildProjectSecret = (input: {
  workloadId: string;
  projectId: string;
  namespace: string;
  bucket: string;
  endpoint: string;
  keys: BucketKeys;
  phase: BucketPhase;
}): V1Secret => ({
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: {
    name: projectSecretName(input.bucket),
    namespace: input.namespace,
    labels: labels(input),
    annotations: { [BUCKET_PHASE_ANNOTATION]: input.phase },
  },
  type: 'Opaque',
  stringData: {
    AWS_ACCESS_KEY_ID: input.keys.accessKeyId,
    AWS_SECRET_ACCESS_KEY: input.keys.secretAccessKey,
    AWS_ENDPOINT_URL: input.endpoint,
    AWS_REGION: S3_REGION,
    S3_BUCKET: input.bucket,
  },
});
