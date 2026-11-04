import type {
  StorageBenchmark,
  StorageBenchmarkResults,
} from '@acceleratio/shared';
import type { StorageBenchmarkRow } from '../schemas/storage-benchmark.schema';
import {
  BENCHMARK_ERROR_PREFIX,
  FIO_JOB_NAMES,
  FIO_JSON_BEGIN,
  FIO_JSON_END,
} from './storage-benchmark.manifests';

const MESSAGE_MAX_LENGTH = 500;

interface FioSide {
  iops?: number;
  bw_bytes?: number;
  bw?: number;
  lat_ns?: { mean?: number };
  clat_ns?: { mean?: number };
}

interface FioJob {
  jobname?: string;
  read?: FioSide;
  write?: FioSide;
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
};

/** MB/s from fio's bytes per second (or KiB/s in older versions). */
const megabytesPerSecond = (side: FioSide | undefined): number => {
  const bytes = side?.bw_bytes ?? (side?.bw ?? 0) * 1024;

  return round(bytes / 1_000_000, 1);
};

const latencyMs = (side: FioSide | undefined): number =>
  round((side?.lat_ns?.mean ?? side?.clat_ns?.mean ?? 0) / 1_000_000, 3);

/**
 * Extracts fio's JSON report from the Job log. Returns null when the markers
 * are missing or the report is not valid JSON.
 */
export const parseBenchmarkLog = (
  log: string,
): StorageBenchmarkResults | null => {
  const begin = log.indexOf(FIO_JSON_BEGIN);
  const end = log.indexOf(FIO_JSON_END, begin + 1);

  if (begin === -1 || end === -1) {
    return null;
  }

  let report: { jobs?: FioJob[] };

  try {
    report = JSON.parse(log.slice(begin + FIO_JSON_BEGIN.length, end)) as {
      jobs?: FioJob[];
    };
  } catch {
    return null;
  }

  const jobs = new Map(
    (report.jobs ?? []).map((job) => [job.jobname ?? '', job]),
  );
  const job = (name: string) => jobs.get(name);

  if (Object.values(FIO_JOB_NAMES).some((name) => !jobs.has(name))) {
    return null;
  }

  const randomRead = job(FIO_JOB_NAMES.randomRead)?.read;
  const randomWrite = job(FIO_JOB_NAMES.randomWrite)?.write;

  return {
    random_read_iops: Math.round(randomRead?.iops ?? 0),
    random_write_iops: Math.round(randomWrite?.iops ?? 0),
    sequential_read_mbps: megabytesPerSecond(
      job(FIO_JOB_NAMES.sequentialRead)?.read,
    ),
    sequential_write_mbps: megabytesPerSecond(
      job(FIO_JOB_NAMES.sequentialWrite)?.write,
    ),
    random_read_latency_ms: latencyMs(randomRead),
    random_write_latency_ms: latencyMs(randomWrite),
  };
};

/**
 * Operator-facing failure text: the script's own error line when present,
 * otherwise the end of the log, capped in length.
 */
export const benchmarkFailureMessage = (
  log: string | null,
  fallback: string,
): string => {
  const lines = (log ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const scripted = lines.find((line) =>
    line.startsWith(BENCHMARK_ERROR_PREFIX),
  );
  const message = scripted
    ? scripted.slice(BENCHMARK_ERROR_PREFIX.length).trim()
    : lines.length > 0
      ? `${fallback} ${lines.slice(-3).join(' ')}`
      : fallback;

  return message.length > MESSAGE_MAX_LENGTH
    ? `${message.slice(0, MESSAGE_MAX_LENGTH - 1)}…`
    : message;
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
  started_at: row.started_at?.toISOString() ?? null,
  finished_at: row.finished_at?.toISOString() ?? null,
  created_at: row.created_at.toISOString(),
});
