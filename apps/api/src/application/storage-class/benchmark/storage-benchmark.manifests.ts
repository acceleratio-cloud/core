import type {
  V1Job,
  V1Namespace,
  V1PersistentVolumeClaim,
} from '@kubernetes/client-node';
import { MANAGED_BY_LABEL, MANAGED_BY_VALUE } from '../storage-class.manifests';

export const BENCHMARK_ID_LABEL = 'acceleratio.io/storage-benchmark-id';
export const BENCHMARK_CLASS_LABEL = 'acceleratio.io/storage-class-id';
export const BENCHMARK_CONTAINER = 'fio';
export const DEFAULT_BENCHMARK_NAMESPACE = 'acceleratio-benchmarks';
/**
 * Alpine 3.23 pinned by index digest. fio comes from Alpine's signed
 * package repository when the Job starts, so the cluster needs outbound
 * access to the Alpine mirror. Override with BENCHMARK_IMAGE.
 */
export const DEFAULT_BENCHMARK_IMAGE =
  'alpine:3.23@sha256:ff7f0c727dd796aa36787bfcd9a64bf35a6ce72a73451b3359fde849b6703d63';

export const VOLUME_SIZE = '2Gi';
export const TEST_FILE_SIZE = '512m';
export const RUNTIME_SECONDS = 15;
/** The Job is killed after this; the API gives up a little later. */
export const ACTIVE_DEADLINE_SECONDS = 600;

export const FIO_JSON_BEGIN = '---FIO-JSON-BEGIN---';
export const FIO_JSON_END = '---FIO-JSON-END---';
export const BENCHMARK_ERROR_PREFIX = 'BENCHMARK_ERROR:';

export const FIO_JOB_NAMES = {
  sequentialWrite: 'sequential-write',
  sequentialRead: 'sequential-read',
  randomWrite: 'random-write',
  randomRead: 'random-read',
} as const;

/** Bytes each random-write job may write; four jobs run in parallel. */
export const RANDOM_WRITE_BYTES_PER_JOB = '64m';

/**
 * Four tests, one after another (`stonewall`): sequential write lays out the
 * test file once, then sequential read, 4k random write and 4k random read.
 *
 * SeaweedFS stores data append-only, so every overwrite consumes new space
 * until the volume is vacuumed, and the volume quota equals the claim size.
 * Write tests are therefore bounded by bytes (the file once, then
 * `io_size` per random writer, about 768 MiB in all), while read tests run
 * for a fixed time. The mount is FUSE, which handles O_DIRECT poorly, so
 * buffered I/O is used with the page cache dropped before each test
 * (`invalidate`) and an fsync at the end of each write test.
 */
export const fioJobFile = (): string =>
  [
    '[global]',
    'directory=/data',
    'filename=fio-benchmark.dat',
    `size=${TEST_FILE_SIZE}`,
    'ioengine=psync',
    'direct=0',
    'invalidate=1',
    `runtime=${RUNTIME_SECONDS}`,
    'end_fsync=1',
    'group_reporting=1',
    'stonewall',
    '',
    `[${FIO_JOB_NAMES.sequentialWrite}]`,
    'rw=write',
    'bs=1m',
    '',
    `[${FIO_JOB_NAMES.sequentialRead}]`,
    'rw=read',
    'bs=1m',
    'time_based=1',
    'ramp_time=2',
    '',
    `[${FIO_JOB_NAMES.randomWrite}]`,
    'rw=randwrite',
    'bs=4k',
    'numjobs=4',
    `io_size=${RANDOM_WRITE_BYTES_PER_JOB}`,
    '',
    `[${FIO_JOB_NAMES.randomRead}]`,
    'rw=randread',
    'bs=4k',
    'numjobs=4',
    'time_based=1',
    'ramp_time=2',
    '',
  ].join('\n');

export const benchmarkScript = (): string =>
  [
    'set -eu',
    `apk add --no-cache fio >/tmp/apk.log 2>&1 || { echo "${BENCHMARK_ERROR_PREFIX} Could not install fio. The cluster needs outbound access to the Alpine package mirror."; tail -n 5 /tmp/apk.log; exit 2; }`,
    "cat > /tmp/benchmark.fio <<'FIO'",
    fioJobFile(),
    'FIO',
    // fio reports I/O errors on stderr; the first one is the useful one
    // (for example ENOSPC, or a disk type no server has).
    `fio --output-format=json --output=/tmp/fio.json /tmp/benchmark.fio 2>/tmp/fio.err || { echo "${BENCHMARK_ERROR_PREFIX} fio could not complete: $(grep -m 1 'fio:' /tmp/fio.err | cut -c 1-200)"; exit 3; }`,
    `echo '${FIO_JSON_BEGIN}'`,
    'cat /tmp/fio.json',
    `echo '${FIO_JSON_END}'`,
  ].join('\n');

const labels = (benchmarkId: string, storageClassId: string) => ({
  [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  [BENCHMARK_ID_LABEL]: benchmarkId,
  [BENCHMARK_CLASS_LABEL]: storageClassId,
});

export const benchmarkExternalName = (benchmarkId: string): string =>
  `storage-benchmark-${benchmarkId.replace(/-/g, '').slice(0, 12)}`;

export const buildBenchmarkNamespace = (name: string): V1Namespace => ({
  apiVersion: 'v1',
  kind: 'Namespace',
  metadata: { name, labels: { [MANAGED_BY_LABEL]: MANAGED_BY_VALUE } },
});

export interface BenchmarkManifestInput {
  benchmarkId: string;
  storageClassId: string;
  storageClassName: string;
  name: string;
  namespace: string;
  image: string;
}

export const buildBenchmarkClaim = (
  input: BenchmarkManifestInput,
): V1PersistentVolumeClaim => ({
  apiVersion: 'v1',
  kind: 'PersistentVolumeClaim',
  metadata: {
    name: input.name,
    namespace: input.namespace,
    labels: labels(input.benchmarkId, input.storageClassId),
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    storageClassName: input.storageClassName,
    resources: { requests: { storage: VOLUME_SIZE } },
  },
});

export const buildBenchmarkJob = (input: BenchmarkManifestInput): V1Job => ({
  apiVersion: 'batch/v1',
  kind: 'Job',
  metadata: {
    name: input.name,
    namespace: input.namespace,
    labels: labels(input.benchmarkId, input.storageClassId),
  },
  spec: {
    backoffLimit: 0,
    activeDeadlineSeconds: ACTIVE_DEADLINE_SECONDS,
    // The API deletes the Job after reading its log; this is the fallback.
    ttlSecondsAfterFinished: 3600,
    template: {
      metadata: { labels: labels(input.benchmarkId, input.storageClassId) },
      spec: {
        restartPolicy: 'Never',
        automountServiceAccountToken: false,
        containers: [
          {
            name: BENCHMARK_CONTAINER,
            image: input.image,
            command: ['sh', '-c', benchmarkScript()],
            volumeMounts: [{ name: 'data', mountPath: '/data' }],
            resources: {
              requests: { cpu: '250m', memory: '128Mi' },
              limits: { cpu: '2', memory: '512Mi' },
            },
            securityContext: { allowPrivilegeEscalation: false },
          },
        ],
        volumes: [
          { name: 'data', persistentVolumeClaim: { claimName: input.name } },
        ],
      },
    },
  },
});
