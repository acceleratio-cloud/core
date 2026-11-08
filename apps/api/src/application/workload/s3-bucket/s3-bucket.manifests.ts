import type { V1Job, V1Secret } from '@kubernetes/client-node';
import type { StorageClassParameters } from '@acceleratio/shared';
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

export const SHELL_CONTAINER = 'weed-shell';
/** Matches the SeaweedFS chart in deploy/install.sh (4.51.0 ships 4.51). */
export const DEFAULT_SEAWEEDFS_SHELL_IMAGE = 'chrislusf/seaweedfs:4.51';
export const DEFAULT_SEAWEEDFS_NAMESPACE = 'seaweedfs';
export const DEFAULT_SEAWEEDFS_MASTER = 'seaweedfs-master.seaweedfs:9333';
export const DEFAULT_SEAWEEDFS_FILER = 'seaweedfs-filer.seaweedfs:8888';
export const DEFAULT_S3_ENDPOINT =
  'http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333';
/** SeaweedFS accepts any region; this is what S3 clients default to. */
export const S3_REGION = 'us-east-1';

/** Prefix of the one log line a failed Job leaves for the API. */
export const BUCKET_ERROR_PREFIX = 'BUCKET_ERROR';
export const ACTIVE_DEADLINE_SECONDS = 120;
export const TTL_AFTER_FINISHED_SECONDS = 600;

/** Bucket actions the per-bucket identity is granted. */
export const BUCKET_ACTIONS = ['Read', 'Write', 'List', 'Tagging'] as const;

export const ACCESS_KEY_ENV = 'S3_ACCESS_KEY';
export const SECRET_KEY_ENV = 'S3_SECRET_KEY';

export type BucketOperation = 'create' | 'rotate' | 'delete';

/** Operations whose Job registers new keys and so reads them from a Secret. */
export const operationNeedsKeys = (operation: BucketOperation): boolean =>
  operation !== 'delete';

export interface SeaweedfsTarget {
  namespace: string;
  master: string;
  filer: string;
  image: string;
}

export interface BucketJobInput {
  workloadId: string;
  projectId: string;
  bucket: string;
  operation: BucketOperation;
  /** Storage rules for `create`. */
  parameters?: Pick<
    StorageClassParameters,
    'replication' | 'disk_type' | 'ttl'
  >;
  target: SeaweedfsTarget;
}

export const bucketIdentity = (workloadId: string): string =>
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

const locationPrefix = (bucket: string): string => `/buckets/${bucket}/`;

/**
 * One `weed shell` line per step. The bucket name is validated before it
 * gets here (lowercase letters, digits, hyphens), and the storage parameters
 * are validated when the profile is saved, so none of them can break out of
 * the shell quoting. The keys are never part of this text: the script
 * expands them from the container environment.
 */
export const bucketCommands = (
  input: Pick<
    BucketJobInput,
    'workloadId' | 'bucket' | 'operation' | 'parameters'
  >,
): { command: string; tolerate?: string }[] => {
  const identity = bucketIdentity(input.workloadId);
  const prefix = locationPrefix(input.bucket);
  const registerIdentity = {
    command: [
      `s3.configure -user=${identity}`,
      `-access_key=$${ACCESS_KEY_ENV}`,
      `-secret_key=$${SECRET_KEY_ENV}`,
      `-buckets=${input.bucket}`,
      `-actions=${BUCKET_ACTIONS.join(',')}`,
      '-apply',
    ].join(' '),
  };

  if (input.operation === 'rotate') {
    // Dropping the identity first removes every old key; registering it
    // again leaves only the new one.
    return [
      {
        command: `s3.configure -user=${identity} -delete -apply`,
        tolerate: 'not found',
      },
      registerIdentity,
    ];
  }

  if (input.operation === 'delete') {
    // Each step tolerates "already gone", so a retried delete converges.
    return [
      {
        command: `s3.configure -user=${identity} -delete -apply`,
        tolerate: 'not found',
      },
      { command: `fs.configure -locationPrefix=${prefix} -delete -apply` },
      {
        command: `s3.bucket.delete -name ${input.bucket}`,
        tolerate: 'not found',
      },
    ];
  }

  const parameters = input.parameters ?? {
    replication: '000',
    disk_type: null,
    ttl: null,
  };
  const rule = [
    `fs.configure -locationPrefix=${prefix}`,
    `-replication=${parameters.replication}`,
    ...(parameters.disk_type ? [`-disk=${parameters.disk_type}`] : []),
    ...(parameters.ttl ? [`-ttl=${parameters.ttl}`] : []),
    '-apply',
  ].join(' ');

  return [
    { command: `s3.bucket.create -name ${input.bucket}` },
    { command: rule },
    registerIdentity,
  ];
};

/**
 * The shell script the Job runs. `weed shell` exits 1 and prints
 * `error: ...` when a command fails; its normal output is discarded because
 * `s3.configure` echoes the secret key. A failure leaves exactly one
 * `BUCKET_ERROR` line in the log.
 */
export const buildBucketScript = (input: BucketJobInput): string => {
  const lines = bucketCommands(input).map(({ command, tolerate }) =>
    tolerate ? `run "${command}" "${tolerate}"` : `run "${command}"`,
  );

  return [
    'set -u',
    `W="weed shell -master=${input.target.master} -filer=${input.target.filer}"`,
    'run() {',
    '  out=$(printf "%s\\n" "$1" | $W 2>&1)',
    '  rc=$?',
    '  if [ "$rc" -eq 0 ]; then return 0; fi',
    '  if [ -n "${2:-}" ] && printf "%s" "$out" | grep -q "$2"; then return 0; fi',
    '  msg=$(printf "%s\\n" "$out" | grep "^error:" | tail -1 | sed "s/^error: *//")',
    `  echo "${BUCKET_ERROR_PREFIX} \${msg:-weed shell exited with $rc}"`,
    '  exit 1',
    '}',
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
  const env = operationNeedsKeys(input.operation)
    ? [ACCESS_KEY_ENV, SECRET_KEY_ENV].map((name) => ({
        name,
        valueFrom: {
          secretKeyRef: {
            name: jobSecretName(input.workloadId, input.operation),
            key: name,
          },
        },
      }))
    : [];

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
      // already exists". The user deletes the failed bucket, which cleans up.
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
              name: SHELL_CONTAINER,
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
