import type {
  StorageBenchmark,
  StorageBenchmarkComparison,
  StorageBenchmarkPoint,
  StorageBenchmarkProgress,
  StorageBenchmarkReport,
  StorageBenchmarkResults,
  StorageBenchmarkTest,
  StorageBenchmarkTestName,
} from '@acceleratio/shared';
import type { StorageBenchmarkRow } from '../schemas/storage-benchmark.schema';
import {
  BENCHMARK_ENGINE,
  BENCHMARK_ERROR_PREFIX,
  BENCHMARK_TESTS,
  TEST_END,
  TEST_FILE_SIZE,
  TEST_JSON,
  TEST_JSON_END,
  TEST_LOG,
  TEST_START,
  type BenchmarkTestDefinition,
} from './storage-benchmark.manifests';

const MESSAGE_MAX_LENGTH = 500;
/** Points kept per test; longer tests are averaged into wider buckets. */
export const SERIES_MAX_POINTS = 120;

interface FioSide {
  iops?: number;
  bw_bytes?: number;
  bw?: number;
  runtime?: number;
  io_bytes?: number;
  lat_ns?: { mean?: number; max?: number };
  clat_ns?: {
    mean?: number;
    max?: number;
    percentile?: Record<string, number>;
  };
}

interface FioJob {
  jobname?: string;
  error?: number;
  read?: FioSide;
  write?: FioSide;
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
};

const nsToMs = (value: number | undefined) =>
  round((value ?? 0) / 1_000_000, 3);

/** MB/s from fio's bytes per second (or KiB/s in older versions). */
const megabytesPerSecond = (side: FioSide | undefined): number => {
  const bytes = side?.bw_bytes ?? (side?.bw ?? 0) * 1024;

  return round(bytes / 1_000_000, 1);
};

const percentile = (side: FioSide | undefined, key: string) =>
  nsToMs(side?.clat_ns?.percentile?.[key]);

const blockLabel = (blockSize: string) =>
  blockSize.endsWith('k')
    ? `${blockSize.slice(0, -1)} KiB`
    : blockSize.endsWith('m')
      ? `${blockSize.slice(0, -1)} MiB`
      : blockSize;

/** Marker lines: `---TEST-START random-read---` → `random-read`. */
const markerValue = (line: string, prefix: string) =>
  line.startsWith(`${prefix} `) && line.endsWith('---')
    ? line.slice(prefix.length + 1, -3)
    : null;

interface RawTest {
  name: string;
  json: string[];
  logs: Map<string, string[]>;
  ended: boolean;
}

/**
 * A fio log line is `msec, value, direction, block size, offset[, prio]`.
 * Values per job are summed (IOPS, bandwidth) or averaged (latency) per
 * second, across the test's jobs.
 */
const parseSeries = (
  logs: Map<string, string[]>,
  name: string,
): StorageBenchmarkPoint[] => {
  type Bucket = { iops: number; kib: number; lat: number; latCount: number };
  const buckets = new Map<number, Bucket>();
  const bucket = (t: number) => {
    let entry = buckets.get(t);

    if (!entry) {
      entry = { iops: 0, kib: 0, lat: 0, latCount: 0 };
      buckets.set(t, entry);
    }

    return entry;
  };

  for (const [file, lines] of logs) {
    const kind = file.startsWith(`${name}_bw.`)
      ? 'bw'
      : file.startsWith(`${name}_iops.`)
        ? 'iops'
        : file.startsWith(`${name}_lat.`)
          ? 'lat'
          : null;

    if (!kind) {
      continue;
    }

    for (const line of lines) {
      const [msecText, valueText] = line.split(',');
      const msec = Number(msecText);
      const value = Number(valueText);

      if (!Number.isFinite(msec) || !Number.isFinite(value)) {
        continue;
      }

      const entry = bucket(Math.max(1, Math.round(msec / 1000)));

      if (kind === 'bw') {
        entry.kib += value;
      } else if (kind === 'iops') {
        entry.iops += value;
      } else {
        entry.lat += value;
        entry.latCount += 1;
      }
    }
  }

  const points = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, entry]) => ({
      t,
      iops: Math.round(entry.iops),
      mbps: round((entry.kib * 1024) / 1_000_000, 1),
      latency_ms: entry.latCount > 0 ? nsToMs(entry.lat / entry.latCount) : 0,
    }));

  return downsample(points);
};

/** Averages consecutive points so a series never exceeds the cap. */
export const downsample = (
  points: StorageBenchmarkPoint[],
  max = SERIES_MAX_POINTS,
): StorageBenchmarkPoint[] => {
  if (points.length <= max) {
    return points;
  }

  const size = Math.ceil(points.length / max);
  const result: StorageBenchmarkPoint[] = [];

  for (let index = 0; index < points.length; index += size) {
    const group = points.slice(index, index + size);
    const mean = (pick: (point: StorageBenchmarkPoint) => number) =>
      group.reduce((sum, point) => sum + pick(point), 0) / group.length;

    result.push({
      t: group[group.length - 1].t,
      iops: Math.round(mean((point) => point.iops)),
      mbps: round(
        mean((point) => point.mbps),
        1,
      ),
      latency_ms: round(
        mean((point) => point.latency_ms),
        3,
      ),
    });
  }

  return result;
};

const toTest = (
  definition: BenchmarkTestDefinition,
  raw: RawTest,
): StorageBenchmarkTest | null => {
  let job: FioJob | undefined;

  try {
    job = (JSON.parse(raw.json.join('\n')) as { jobs?: FioJob[] }).jobs?.[0];
  } catch {
    return null;
  }

  if (!job) {
    return null;
  }

  const side = definition.direction === 'read' ? job.read : job.write;

  return {
    name: definition.name,
    label: definition.label,
    pattern: definition.pattern,
    direction: definition.direction,
    parameters: {
      block_size: blockLabel(definition.blockSize),
      jobs: definition.jobs,
      engine: BENCHMARK_ENGINE,
      direct: false,
      file_size: blockLabel(TEST_FILE_SIZE),
      limit: definition.limit,
    },
    iops: Math.round(side?.iops ?? 0),
    bandwidth_mbps: megabytesPerSecond(side),
    latency_ms: {
      mean: nsToMs(side?.lat_ns?.mean ?? side?.clat_ns?.mean),
      p50: percentile(side, '50.000000'),
      p95: percentile(side, '95.000000'),
      p99: percentile(side, '99.000000'),
      p999: percentile(side, '99.900000'),
      max: nsToMs(side?.lat_ns?.max ?? side?.clat_ns?.max),
    },
    runtime_seconds: round((side?.runtime ?? 0) / 1000, 1),
    io_mb: round((side?.io_bytes ?? 0) / 1_000_000, 1),
    error_code: job.error ?? 0,
    series: parseSeries(raw.logs, definition.name),
  };
};

export interface ParsedBenchmarkLog {
  tests: StorageBenchmarkTest[];
  /** The test that started and has not finished yet. */
  currentTest: StorageBenchmarkTestName | null;
  /** `[step]` from the script's error line, when there is one. */
  failedStep: string | null;
  /** The script's error message, when there is one. */
  error: string | null;
}

/** Reads the per-test sections the benchmark script prints. */
export const parseBenchmarkLog = (log: string): ParsedBenchmarkLog => {
  const raws: RawTest[] = [];
  let current: RawTest | null = null;
  let section: { kind: 'json' } | { kind: 'log'; file: string } | null = null;
  let error: string | null = null;
  let failedStep: string | null = null;

  for (const rawLine of log.split('\n')) {
    const line = rawLine.trimEnd();

    if (line.startsWith(BENCHMARK_ERROR_PREFIX)) {
      const match = /^BENCHMARK_ERROR(?:\[([a-z-]+)\])?:\s*(.*)$/.exec(line);

      failedStep = match?.[1] ?? null;
      error = (match?.[2] ?? line).trim();
      continue;
    }

    const started = markerValue(line, TEST_START);

    if (started) {
      current = { name: started, json: [], logs: new Map(), ended: false };
      raws.push(current);
      section = null;
      continue;
    }

    if (!current) {
      continue;
    }

    if (markerValue(line, TEST_END) === current.name) {
      current.ended = true;
      section = null;
      continue;
    }

    if (markerValue(line, TEST_JSON) === current.name) {
      section = { kind: 'json' };
      continue;
    }

    if (line === TEST_JSON_END) {
      section = null;
      continue;
    }

    const file = markerValue(line, TEST_LOG);

    if (file) {
      section = { kind: 'log', file };
      current.logs.set(file, []);
      continue;
    }

    if (section?.kind === 'json') {
      current.json.push(rawLine);
    } else if (section?.kind === 'log' && line) {
      current.logs.get(section.file)?.push(line);
    }
  }

  const tests: StorageBenchmarkTest[] = [];

  for (const definition of BENCHMARK_TESTS) {
    const raw = raws.find(
      (item) => item.name === definition.name && item.ended,
    );
    const test = raw ? toTest(definition, raw) : null;

    if (test) {
      tests.push(test);
    }
  }

  const running = raws.find((item) => !item.ended);
  const currentTest =
    BENCHMARK_TESTS.find((definition) => definition.name === running?.name)
      ?.name ?? null;

  return { tests, currentTest, failedStep, error };
};

/** The four headline numbers, once every test has a result. */
export const summarizeTests = (
  tests: StorageBenchmarkTest[],
): StorageBenchmarkResults | null => {
  const byName = new Map(tests.map((test) => [test.name, test]));
  const randomRead = byName.get('random-read');
  const randomWrite = byName.get('random-write');
  const sequentialRead = byName.get('sequential-read');
  const sequentialWrite = byName.get('sequential-write');

  if (!randomRead || !randomWrite || !sequentialRead || !sequentialWrite) {
    return null;
  }

  return {
    random_read_iops: randomRead.iops,
    random_write_iops: randomWrite.iops,
    sequential_read_mbps: sequentialRead.bandwidth_mbps,
    sequential_write_mbps: sequentialWrite.bandwidth_mbps,
    random_read_latency_ms: randomRead.latency_ms.mean,
    random_write_latency_ms: randomWrite.latency_ms.mean,
  };
};

/** Operator-facing failure text, capped in length. */
export const benchmarkFailureMessage = (
  parsed: Pick<ParsedBenchmarkLog, 'error'> | null,
  log: string | null,
  fallback: string,
): string => {
  const tail = (log ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('---'))
    .slice(-3);
  const message =
    parsed?.error ??
    (tail.length > 0 ? `${fallback} ${tail.join(' ')}` : fallback);

  return message.length > MESSAGE_MAX_LENGTH
    ? `${message.slice(0, MESSAGE_MAX_LENGTH - 1)}…`
    : message;
};

const progressOf = (
  row: StorageBenchmarkRow,
): StorageBenchmarkProgress | null =>
  row.tests === null && row.current_test === null
    ? null
    : {
        current_test: row.current_test as StorageBenchmarkTestName | null,
        completed: row.tests?.length ?? 0,
        total: BENCHMARK_TESTS.length,
      };

export const toStorageBenchmark = (
  row: StorageBenchmarkRow,
): StorageBenchmark => ({
  id: row.id,
  storage_class_id: row.storage_class_id,
  storage_class_name: row.storage_class_name,
  status: row.status,
  status_message: row.status_message,
  results: row.results,
  failed_step: row.failed_step,
  progress: progressOf(row),
  started_at: row.started_at?.toISOString() ?? null,
  finished_at: row.finished_at?.toISOString() ?? null,
  created_at: row.created_at.toISOString(),
});

export const toComparison = (
  row: StorageBenchmarkRow,
): StorageBenchmarkComparison => ({
  id: row.id,
  created_at: row.created_at.toISOString(),
  results: row.results,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tests: (row.tests ?? []).map(({ series, ...test }) => test),
});

export const toStorageBenchmarkReport = (
  row: StorageBenchmarkRow,
  previous: StorageBenchmarkRow | null,
): StorageBenchmarkReport => ({
  ...toStorageBenchmark(row),
  tests: row.tests ?? [],
  profile_snapshot: row.profile_snapshot,
  environment: row.environment,
  previous: previous ? toComparison(previous) : null,
});
