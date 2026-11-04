import type {
  V1Job,
  V1Namespace,
  V1PersistentVolumeClaim,
} from '@kubernetes/client-node';
import type { StorageBenchmarkTestName } from '@acceleratio/shared';
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

export const BENCHMARK_ERROR_PREFIX = 'BENCHMARK_ERROR';
export const TEST_START = '---TEST-START';
export const TEST_JSON = '---TEST-JSON';
export const TEST_JSON_END = '---TEST-JSON-END---';
export const TEST_LOG = '---TEST-LOG';
export const TEST_END = '---TEST-END';
/** fio averages its bandwidth, IOPS and latency logs over this window. */
export const LOG_AVERAGE_MS = 1000;
/** Bytes each random-write job may write; four jobs run in parallel. */
export const RANDOM_WRITE_BYTES_PER_JOB = '64m';

export interface BenchmarkTestDefinition {
  name: StorageBenchmarkTestName;
  label: string;
  pattern: 'sequential' | 'random';
  direction: 'read' | 'write';
  rw: string;
  blockSize: string;
  jobs: number;
  /** fio options that end the test. */
  options: string[];
  limit: string;
}

/**
 * The four tests, run one after another as separate fio invocations so the
 * API can follow progress test by test. Sequential write lays out the test
 * file once; the other tests reuse it.
 *
 * SeaweedFS stores data append-only, so every overwrite consumes new space
 * until the volume is vacuumed, and the volume quota equals the claim size.
 * Write tests are therefore bounded by bytes (the file once, then
 * `io_size` per random writer, about 768 MiB in all), while read tests run
 * for a fixed time. The mount is FUSE, which handles O_DIRECT poorly, so
 * buffered I/O is used with the page cache dropped before each test
 * (`invalidate`) and an fsync at the end of each write test.
 */
export const BENCHMARK_TESTS: BenchmarkTestDefinition[] = [
  {
    name: 'sequential-write',
    label: 'Sequential write',
    pattern: 'sequential',
    direction: 'write',
    rw: 'write',
    blockSize: '1m',
    jobs: 1,
    options: [],
    limit: `Writes the ${TEST_FILE_SIZE.replace('m', ' MiB')} file once`,
  },
  {
    name: 'sequential-read',
    label: 'Sequential read',
    pattern: 'sequential',
    direction: 'read',
    rw: 'read',
    blockSize: '1m',
    jobs: 1,
    options: ['time_based=1', 'ramp_time=2'],
    limit: `${RUNTIME_SECONDS} s`,
  },
  {
    name: 'random-write',
    label: 'Random 4 KiB write',
    pattern: 'random',
    direction: 'write',
    rw: 'randwrite',
    blockSize: '4k',
    jobs: 4,
    options: [`io_size=${RANDOM_WRITE_BYTES_PER_JOB}`],
    limit: `${RANDOM_WRITE_BYTES_PER_JOB.replace('m', ' MiB')} per job, at most ${RUNTIME_SECONDS} s`,
  },
  {
    name: 'random-read',
    label: 'Random 4 KiB read',
    pattern: 'random',
    direction: 'read',
    rw: 'randread',
    blockSize: '4k',
    jobs: 4,
    options: ['time_based=1', 'ramp_time=2'],
    limit: `${RUNTIME_SECONDS} s`,
  },
];

export const BENCHMARK_ENGINE = 'psync';

export const fioJobFile = (): string =>
  [
    '[global]',
    'directory=/data',
    'filename=fio-benchmark.dat',
    `size=${TEST_FILE_SIZE}`,
    `ioengine=${BENCHMARK_ENGINE}`,
    'direct=0',
    'invalidate=1',
    `runtime=${RUNTIME_SECONDS}`,
    'end_fsync=1',
    'group_reporting=1',
    `log_avg_msec=${LOG_AVERAGE_MS}`,
    '',
    ...BENCHMARK_TESTS.flatMap((test) => [
      `[${test.name}]`,
      `rw=${test.rw}`,
      `bs=${test.blockSize}`,
      ...(test.jobs > 1 ? [`numjobs=${test.jobs}`] : []),
      ...test.options,
      // Per-second averages for the progress charts, in /tmp/logs.
      `write_bw_log=/tmp/logs/${test.name}`,
      `write_iops_log=/tmp/logs/${test.name}`,
      `write_lat_log=/tmp/logs/${test.name}`,
      '',
    ]),
  ].join('\n');

const runTest = (name: string): string =>
  [
    `echo '${TEST_START} ${name}---'`,
    // fio reports I/O errors on stderr; the first one is the useful one
    // (for example ENOSPC, or a disk type no server has).
    `fio --section=${name} --output-format=json --output=/tmp/${name}.json /tmp/benchmark.fio 2>/tmp/${name}.err || { echo "${BENCHMARK_ERROR_PREFIX}[${name}]: fio could not complete: $(grep -m 1 'fio:' /tmp/${name}.err | cut -c 1-200)"; exit 3; }`,
    `echo '${TEST_JSON} ${name}---'`,
    `cat /tmp/${name}.json`,
    `echo '${TEST_JSON_END}'`,
    `for f in /tmp/logs/${name}_bw.*.log /tmp/logs/${name}_iops.*.log /tmp/logs/${name}_lat.*.log; do [ -f "$f" ] && { echo "${TEST_LOG} $(basename "$f")---"; cat "$f"; }; done`,
    `echo '${TEST_END} ${name}---'`,
  ].join('\n');

export const benchmarkScript = (): string =>
  [
    'set -eu',
    'mkdir -p /tmp/logs',
    `apk add --no-cache fio >/tmp/apk.log 2>&1 || { echo "${BENCHMARK_ERROR_PREFIX}[install]: Could not install fio. The cluster needs outbound access to the Alpine package mirror."; tail -n 5 /tmp/apk.log; exit 2; }`,
    "cat > /tmp/benchmark.fio <<'FIO'",
    fioJobFile(),
    'FIO',
    ...BENCHMARK_TESTS.map((test) => runTest(test.name)),
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
