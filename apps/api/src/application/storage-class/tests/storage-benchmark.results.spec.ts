import type { StorageBenchmarkPoint } from '@acceleratio/shared';
import {
  BENCHMARK_TESTS,
  benchmarkExternalName,
  benchmarkScript,
  buildBenchmarkClaim,
  buildBenchmarkJob,
  DEFAULT_BENCHMARK_IMAGE,
  fioJobFile,
} from '../benchmark/storage-benchmark.manifests';
import {
  benchmarkFailureMessage,
  downsample,
  parseBenchmarkLog,
  SERIES_MAX_POINTS,
  summarizeTests,
} from '../benchmark/storage-benchmark.results';
import { jobOutcome } from '@/vendor/kubernetes/job-outcome';

// The service module imports the Kubernetes service; only the pure
// `jobOutcome` helper is used here.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const benchmarkId = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const storageClassId = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const input = {
  benchmarkId,
  storageClassId,
  storageClassName: 'sc-fast-7c1d2e3f',
  name: benchmarkExternalName(benchmarkId),
  namespace: 'acceleratio-benchmarks',
  image: DEFAULT_BENCHMARK_IMAGE,
};

const side = (iops: number, bytes: number) => ({
  iops,
  bw_bytes: bytes,
  runtime: 15_000,
  io_bytes: bytes * 15,
  lat_ns: { mean: 1_000_000, max: 9_000_000 },
  clat_ns: {
    mean: 900_000,
    max: 9_000_000,
    percentile: {
      '50.000000': 700_000,
      '95.000000': 2_000_000,
      '99.000000': 4_000_000,
      '99.900000': 8_000_000,
    },
  },
});

const fioJson = (name: string, read: boolean, iops: number, bytes: number) =>
  JSON.stringify(
    {
      jobs: [
        {
          jobname: name,
          error: 0,
          read: read ? side(iops, bytes) : side(0, 0),
          write: read ? side(0, 0) : side(iops, bytes),
        },
      ],
    },
    null,
    2,
  );

/** What the benchmark script prints for one test. */
const testOutput = (
  name: string,
  read: boolean,
  iops: number,
  bytes: number,
  jobs = 1,
) => {
  const logs: string[] = [];

  for (let job = 1; job <= jobs; job += 1) {
    logs.push(
      `---TEST-LOG ${name}_bw.${job}.log---`,
      '1000, 1000, 0, 4096, 0',
      '2000, 2000, 0, 4096, 0',
      `---TEST-LOG ${name}_iops.${job}.log---`,
      '1000, 100, 0, 4096, 0',
      '2000, 200, 0, 4096, 0',
      `---TEST-LOG ${name}_lat.${job}.log---`,
      '1000, 1000000, 0, 4096, 0',
      '2000, 3000000, 0, 4096, 0',
    );
  }

  return [
    `---TEST-START ${name}---`,
    `---TEST-JSON ${name}---`,
    fioJson(name, read, iops, bytes),
    '---TEST-JSON-END---',
    ...logs,
    `---TEST-END ${name}---`,
  ].join('\n');
};

const fullLog = [
  'fetch https://dl-cdn.alpinelinux.org/...',
  testOutput('sequential-write', false, 95, 99_800_000),
  testOutput('sequential-read', true, 300, 314_572_800),
  testOutput('random-write', false, 1234.6, 5_000_000, 4),
  testOutput('random-read', true, 5678.4, 23_000_000, 4),
].join('\n');

describe('benchmark manifests', () => {
  it('names resources after the benchmark id', () => {
    expect(input.name).toBe('storage-benchmark-9d8c7b6a5f4e');
  });

  it('claims a temporary volume of the profile', () => {
    const claim = buildBenchmarkClaim(input);

    expect(claim.spec?.storageClassName).toBe('sc-fast-7c1d2e3f');
    expect(claim.spec?.resources?.requests?.storage).toBe('2Gi');
    expect(claim.metadata?.labels).toMatchObject({
      'app.kubernetes.io/managed-by': 'acceleratio',
      'acceleratio.io/storage-benchmark-id': benchmarkId,
    });
  });

  it('runs one bounded, non-retrying fio pod on the claim', () => {
    const job = buildBenchmarkJob(input);
    const pod = job.spec?.template.spec;

    expect(job.spec).toMatchObject({
      backoffLimit: 0,
      activeDeadlineSeconds: 600,
    });
    expect(pod?.restartPolicy).toBe('Never');
    expect(pod?.automountServiceAccountToken).toBe(false);
    expect(pod?.containers[0].image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(pod?.volumes?.[0].persistentVolumeClaim?.claimName).toBe(input.name);
  });

  it('bounds writes by bytes and logs per-second averages', () => {
    const file = fioJobFile();
    const section = (name: string) =>
      file.split(/\n(?=\[)/).find((part) => part.startsWith(`[${name}]`)) ?? '';

    // A run fits its 2 GiB claim on any driver.
    expect(section('sequential-write')).not.toContain('time_based');
    expect(section('random-write')).toContain('io_size=64m');
    expect(section('random-write')).not.toContain('time_based');
    expect(section('random-read')).toContain('time_based=1');
    expect(file).toContain('log_avg_msec=1000');
    for (const test of BENCHMARK_TESTS) {
      expect(section(test.name)).toContain(
        `write_iops_log=/tmp/logs/${test.name}`,
      );
    }
  });

  it('runs each test separately between markers', () => {
    const script = benchmarkScript();

    expect(script).toContain('apk add --no-cache fio');
    expect(script).toContain('BENCHMARK_ERROR[install]');
    for (const test of BENCHMARK_TESTS) {
      expect(script).toContain(`--section=${test.name}`);
      expect(script).toContain(`---TEST-START ${test.name}---`);
      expect(script).toContain(`---TEST-END ${test.name}---`);
      expect(script).toContain(`BENCHMARK_ERROR[${test.name}]`);
    }
  });
});

describe('parseBenchmarkLog', () => {
  it('reads every test with latency percentiles and series', () => {
    const parsed = parseBenchmarkLog(fullLog);

    expect(parsed.tests.map((test) => test.name)).toEqual([
      'sequential-write',
      'sequential-read',
      'random-write',
      'random-read',
    ]);
    expect(parsed.currentTest).toBeNull();
    expect(parsed.error).toBeNull();

    const randomRead = parsed.tests[3];

    expect(randomRead).toMatchObject({
      label: 'Random 4 KiB read',
      direction: 'read',
      iops: 5678,
      bandwidth_mbps: 23,
      runtime_seconds: 15,
      error_code: 0,
      parameters: { block_size: '4 KiB', jobs: 4, engine: 'psync' },
      latency_ms: { mean: 1, p50: 0.7, p95: 2, p99: 4, p999: 8, max: 9 },
    });
    // Four jobs: IOPS and bandwidth add up, latency averages.
    expect(randomRead.series).toEqual([
      { t: 1, iops: 400, mbps: 4.1, latency_ms: 1 },
      { t: 2, iops: 800, mbps: 8.2, latency_ms: 3 },
    ]);
  });

  it('summarizes the four headline numbers', () => {
    expect(summarizeTests(parseBenchmarkLog(fullLog).tests)).toEqual({
      random_read_iops: 5678,
      random_write_iops: 1235,
      sequential_read_mbps: 314.6,
      sequential_write_mbps: 99.8,
      random_read_latency_ms: 1,
      random_write_latency_ms: 1,
    });
  });

  it('reports the running test and finished tests mid-run', () => {
    const partial = [
      testOutput('sequential-write', false, 95, 99_800_000),
      '---TEST-START sequential-read---',
    ].join('\n');
    const parsed = parseBenchmarkLog(partial);

    expect(parsed.tests).toHaveLength(1);
    expect(parsed.currentTest).toBe('sequential-read');
    expect(summarizeTests(parsed.tests)).toBeNull();
  });

  it('reads the failing step and message', () => {
    const parsed = parseBenchmarkLog(
      [
        testOutput('sequential-write', false, 95, 99_800_000),
        '---TEST-START sequential-read---',
        'BENCHMARK_ERROR[sequential-read]: fio could not complete: No space left on device',
      ].join('\n'),
    );

    expect(parsed.failedStep).toBe('sequential-read');
    expect(parsed.error).toBe(
      'fio could not complete: No space left on device',
    );
    expect(parsed.tests).toHaveLength(1);
  });

  it('skips a test whose report is not valid JSON', () => {
    const parsed = parseBenchmarkLog(
      [
        '---TEST-START sequential-write---',
        '---TEST-JSON sequential-write---',
        '{oops',
        '---TEST-JSON-END---',
        '---TEST-END sequential-write---',
      ].join('\n'),
    );

    expect(parsed.tests).toEqual([]);
  });
});

describe('downsample', () => {
  it('keeps short series and averages long ones under the cap', () => {
    const points: StorageBenchmarkPoint[] = Array.from(
      { length: 300 },
      (_, index) => ({
        t: index + 1,
        iops: 100,
        mbps: 1,
        latency_ms: 2,
      }),
    );

    expect(downsample(points.slice(0, 10))).toHaveLength(10);

    const reduced = downsample(points);

    expect(reduced.length).toBeLessThanOrEqual(SERIES_MAX_POINTS);
    expect(reduced[0]).toEqual({ t: 3, iops: 100, mbps: 1, latency_ms: 2 });
  });
});

describe('benchmarkFailureMessage', () => {
  it('prefers the script error, then the log tail, capped', () => {
    expect(
      benchmarkFailureMessage({ error: 'Could not install fio.' }, 'x', 'F.'),
    ).toBe('Could not install fio.');
    expect(benchmarkFailureMessage({ error: null }, 'a\nb\nc\nd', 'F.')).toBe(
      'F. b c d',
    );
    expect(benchmarkFailureMessage(null, null, 'F.')).toBe('F.');
    expect(
      benchmarkFailureMessage({ error: 'x'.repeat(900) }, null, 'F.').length,
    ).toBeLessThanOrEqual(500);
  });
});

describe('jobOutcome', () => {
  it('reads Job status and conditions', () => {
    expect(jobOutcome({ status: {} })).toBe('running');
    expect(jobOutcome({ status: { succeeded: 1 } })).toBe('succeeded');
    expect(jobOutcome({ status: { failed: 1 } })).toBe('failed');
    expect(
      jobOutcome({
        status: {
          conditions: [
            { type: 'Failed', status: 'True', reason: 'DeadlineExceeded' },
          ],
        },
      }),
    ).toBe('failed');
  });
});
