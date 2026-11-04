import {
  benchmarkExternalName,
  benchmarkScript,
  buildBenchmarkClaim,
  buildBenchmarkJob,
  DEFAULT_BENCHMARK_IMAGE,
  FIO_JSON_BEGIN,
  FIO_JSON_END,
} from '../benchmark/storage-benchmark.manifests';
import {
  benchmarkFailureMessage,
  parseBenchmarkLog,
} from '../benchmark/storage-benchmark.results';
import { jobOutcome } from '../benchmark/storage-benchmark.service';

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

const fioReport = {
  'fio version': 'fio-3.38',
  jobs: [
    {
      jobname: 'sequential-write',
      read: { iops: 0, bw_bytes: 0 },
      write: { iops: 95.2, bw_bytes: 99_800_000, lat_ns: { mean: 10_000_000 } },
    },
    {
      jobname: 'sequential-read',
      read: { iops: 300, bw_bytes: 314_572_800 },
      write: { iops: 0, bw_bytes: 0 },
    },
    {
      jobname: 'random-write',
      read: { iops: 0 },
      write: { iops: 1234.6, lat_ns: { mean: 3_210_000 } },
    },
    {
      jobname: 'random-read',
      read: { iops: 5678.4, clat_ns: { mean: 702_400 } },
      write: { iops: 0 },
    },
  ],
};

const logWith = (report: unknown) =>
  [
    'fetch https://dl-cdn.alpinelinux.org/...',
    FIO_JSON_BEGIN,
    JSON.stringify(report, null, 2),
    FIO_JSON_END,
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
    expect(pod?.containers[0].image).toBe(DEFAULT_BENCHMARK_IMAGE);
    expect(pod?.containers[0].image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(pod?.volumes?.[0].persistentVolumeClaim?.claimName).toBe(input.name);
  });

  it('prints the fio report between markers', () => {
    const script = benchmarkScript();

    expect(script).toContain('apk add --no-cache fio');
    expect(script).toContain('--output-format=json');
    expect(script.indexOf(FIO_JSON_BEGIN)).toBeLessThan(
      script.indexOf(FIO_JSON_END),
    );
    // Overwrites consume new space on SeaweedFS: writes are bounded by
    // bytes, only reads run for a fixed time.
    const sections = script.split(/\n(?=\[)/);
    const section = (name: string) =>
      sections.find((part) => part.startsWith(`[${name}]`)) ?? '';

    expect(section('sequential-write')).not.toContain('time_based');
    expect(section('random-write')).toContain('io_size=64m');
    expect(section('random-write')).not.toContain('time_based');
    expect(section('random-read')).toContain('time_based=1');
    expect(script).toContain("grep -m 1 'fio:' /tmp/fio.err");
    for (const name of [
      'sequential-write',
      'sequential-read',
      'random-write',
      'random-read',
    ]) {
      expect(script).toContain(`[${name}]`);
    }
  });
});

describe('parseBenchmarkLog', () => {
  it('reads IOPS, throughput and latency', () => {
    expect(parseBenchmarkLog(logWith(fioReport))).toEqual({
      random_read_iops: 5678,
      random_write_iops: 1235,
      sequential_read_mbps: 314.6,
      sequential_write_mbps: 99.8,
      random_read_latency_ms: 0.702,
      random_write_latency_ms: 3.21,
    });
  });

  it('accepts the older KiB/s bandwidth field', () => {
    const report = structuredClone(fioReport);

    report.jobs[1].read = { iops: 300, bw: 1000 } as never;

    expect(parseBenchmarkLog(logWith(report))?.sequential_read_mbps).toBe(1);
  });

  it('returns null for missing markers, bad JSON or missing tests', () => {
    expect(parseBenchmarkLog('no report')).toBeNull();
    expect(
      parseBenchmarkLog(`${FIO_JSON_BEGIN}\n{oops\n${FIO_JSON_END}`),
    ).toBeNull();
    expect(
      parseBenchmarkLog(logWith({ jobs: fioReport.jobs.slice(0, 2) })),
    ).toBeNull();
  });
});

describe('benchmarkFailureMessage', () => {
  it('prefers the script error line', () => {
    expect(
      benchmarkFailureMessage(
        'x\nBENCHMARK_ERROR: Could not install fio.\nERROR: network',
        'Failed.',
      ),
    ).toBe('Could not install fio.');
  });

  it('falls back to the log tail, then the fallback, capped', () => {
    expect(benchmarkFailureMessage('a\nb\nc\nd', 'Failed.')).toBe(
      'Failed. b c d',
    );
    expect(benchmarkFailureMessage(null, 'Failed.')).toBe('Failed.');
    expect(
      benchmarkFailureMessage('x'.repeat(900), 'Failed.').length,
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
