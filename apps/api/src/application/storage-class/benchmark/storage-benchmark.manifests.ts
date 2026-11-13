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

/**
 * How a run measures. Results compare only within one method. 1 was
 * buffered psync I/O for SeaweedFS's FUSE mount; 2 is direct libaio I/O on
 * Longhorn block volumes with separate queue-depth-1 latency tests.
 */
export const BENCHMARK_METHOD = 2;

export const VOLUME_SIZE = '4Gi';
/** Large enough that a run does not settle in a replica server's cache. */
export const TEST_FILE_SIZE = '2g';
export const RUNTIME_SECONDS = 15;
export const RAMP_SECONDS = 2;
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
/** Writes the whole test file before the tests; not reported. */
export const PREPARE_SECTION = 'prepare';

export interface BenchmarkTestDefinition {
  name: StorageBenchmarkTestName;
  label: string;
  pattern: 'sequential' | 'random';
  direction: 'read' | 'write';
  rw: string;
  blockSize: string;
  jobs: number;
  ioDepth: number;
  limit: string;
}

const LIMIT = `${RUNTIME_SECONDS} s`;

/**
 * The six tests, run one after another as separate fio invocations so the
 * API can follow progress test by test.
 *
 * Longhorn volumes are block devices, so I/O is direct (no page cache in the
 * pod) through libaio, and every test runs for a fixed time; overwrites take
 * no new space. The file is written in full first, because reads from
 * never-written parts of a thin Longhorn volume return zeros without
 * touching a disk. Throughput tests keep many requests in flight, as
 * Longhorn's engine needs; the latency tests send one request at a time,
 * which is what a database's commit waits on.
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
    ioDepth: 16,
    limit: LIMIT,
  },
  {
    name: 'sequential-read',
    label: 'Sequential read',
    pattern: 'sequential',
    direction: 'read',
    rw: 'read',
    blockSize: '1m',
    jobs: 1,
    ioDepth: 16,
    limit: LIMIT,
  },
  {
    name: 'random-write',
    label: 'Random 4 KiB write',
    pattern: 'random',
    direction: 'write',
    rw: 'randwrite',
    blockSize: '4k',
    jobs: 4,
    ioDepth: 16,
    limit: LIMIT,
  },
  {
    name: 'random-read',
    label: 'Random 4 KiB read',
    pattern: 'random',
    direction: 'read',
    rw: 'randread',
    blockSize: '4k',
    jobs: 4,
    ioDepth: 16,
    limit: LIMIT,
  },
  {
    name: 'random-write-latency',
    label: 'Single 4 KiB write latency',
    pattern: 'random',
    direction: 'write',
    rw: 'randwrite',
    blockSize: '4k',
    jobs: 1,
    ioDepth: 1,
    limit: LIMIT,
  },
  {
    name: 'random-read-latency',
    label: 'Single 4 KiB read latency',
    pattern: 'random',
    direction: 'read',
    rw: 'randread',
    blockSize: '4k',
    jobs: 1,
    ioDepth: 1,
    limit: LIMIT,
  },
];

export const BENCHMARK_ENGINE = 'libaio';

export const fioJobFile = (): string =>
  [
    '[global]',
    'directory=/data',
    'filename=fio-benchmark.dat',
    `size=${TEST_FILE_SIZE}`,
    `ioengine=${BENCHMARK_ENGINE}`,
    'direct=1',
    // Percentiles of the full latency: with libaio much of it is submission.
    'lat_percentiles=1',
    'group_reporting=1',
    `log_avg_msec=${LOG_AVERAGE_MS}`,
    '',
    `[${PREPARE_SECTION}]`,
    'rw=write',
    'bs=1m',
    'iodepth=16',
    '',
    ...BENCHMARK_TESTS.flatMap((test) => [
      `[${test.name}]`,
      `rw=${test.rw}`,
      `bs=${test.blockSize}`,
      `iodepth=${test.ioDepth}`,
      ...(test.jobs > 1 ? [`numjobs=${test.jobs}`] : []),
      'time_based=1',
      `runtime=${RUNTIME_SECONDS}`,
      `ramp_time=${RAMP_SECONDS}`,
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
    `fio --section=${PREPARE_SECTION} --output=/dev/null /tmp/benchmark.fio 2>/tmp/${PREPARE_SECTION}.err || { echo "${BENCHMARK_ERROR_PREFIX}[${PREPARE_SECTION}]: Could not write the test file: $(grep -m 1 'fio:' /tmp/${PREPARE_SECTION}.err | cut -c 1-200)"; exit 3; }`,
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
