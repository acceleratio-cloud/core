import {
  LOG_LEVELS,
  LOG_RANGES,
  type LogHistogramBucket,
  type LogLevel,
  type LogLevelFilter,
  type LogRange,
  type ProjectLogEntry,
} from '@acceleratio/shared';
import type {
  HitsSeries,
  LogRecord,
} from '@/vendor/victorialogs/victorialogs.client';

export const DEFAULT_LOG_RANGE: LogRange = '1h';

const RANGE_SECONDS: Record<LogRange, number> = {
  '15m': 15 * 60,
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
};

/** Bars the frequency chart aims for, whatever the window. */
const HISTOGRAM_BUCKETS = 60;

/** Bucket widths the histogram snaps to, in seconds. */
const HISTOGRAM_STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600,
  43200, 86400,
];

/** The fields a log line is read with; everything else stays in storage. */
const ENTRY_FIELDS = [
  '_time',
  '_msg',
  '_stream_id',
  'level',
  'stream',
  'workload_id',
  'pod',
  'container',
];

export const isLogRange = (value: unknown): value is LogRange =>
  typeof value === 'string' &&
  (LOG_RANGES as readonly string[]).includes(value);

export const rangeSeconds = (range: LogRange): number => RANGE_SECONDS[range];

/** A time window in unix milliseconds, `start` inclusive, `end` exclusive. */
export interface LogWindow {
  start: number;
  end: number;
}

/** What a request narrows the project's logs to. */
export interface LogFilters {
  workloadIds: string[];
  pods: string[];
  levels: LogLevelFilter[];
  /** Case-insensitive text, matched anywhere in the message. */
  search: string | null;
}

/**
 * A LogsQL string literal. JSON escaping is a subset of what LogsQL accepts
 * (Go-style quoted strings), so any user text becomes inert data.
 */
export const quote = (value: string): string => JSON.stringify(value);

/**
 * Escapes RE2 metacharacters so search text matches literally inside a
 * regexp filter.
 */
export const escapeRegex = (value: string): string =>
  value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

const inList = (values: string[]): string =>
  `in(${values.map(quote).join(', ')})`;

const toRfc3339 = (ms: number): string => new Date(ms).toISOString();

/**
 * The filter part of every query: the project's namespace stream first, so
 * nothing outside the project can ever match, then the optional filters.
 * Used as is by the live tail, which accepts no time filter or pipes.
 */
export const filterQuery = (namespace: string, filters: LogFilters): string => {
  const parts = [`{namespace=${quote(namespace)}}`];

  if (filters.workloadIds.length > 0) {
    parts.push(`workload_id:${inList(filters.workloadIds)}`);
  }

  if (filters.pods.length > 0) {
    parts.push(`pod:${inList(filters.pods)}`);
  }

  if (filters.levels.length > 0) {
    const known = filters.levels.filter((level) => level !== 'unknown');
    const clauses: string[] = [];

    if (known.length > 0) {
      clauses.push(`level:${inList(known)}`);
    }

    if (filters.levels.includes('unknown')) {
      // An absent field reads as empty; Vector drops null levels.
      clauses.push('level:""');
    }

    parts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`);
  }

  if (filters.search) {
    // A substring match, as users expect from a search box: the word filter
    // `i("…")` would not find "batch 22" in "batch 22712".
    parts.push(`~${quote(`(?i)${escapeRegex(filters.search)}`)}`);
  }

  return parts.join(' ');
};

/**
 * Where the next page starts: lines at `time` or older, after skipping the
 * `skip` lines at exactly `time` that earlier pages returned. A bare time
 * would lose lines that share the boundary timestamp.
 */
export interface LogCursor {
  time: string;
  skip: number;
}

const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export const isRfc3339 = (value: string): boolean => RFC3339.test(value);

/** `<time>~<skip>`; a bare time (skip 0) is accepted too. */
export const parseCursor = (value: string): LogCursor | null => {
  const [time, skip = '0', extra] = value.split('~');

  if (extra !== undefined || !isRfc3339(time) || !/^\d{1,6}$/.test(skip)) {
    return null;
  }

  return { time, skip: Number(skip) };
};

export const formatCursor = (cursor: LogCursor): string =>
  `${cursor.time}~${cursor.skip}`;

/** The cursor after a full page, or null when the window is exhausted. */
export const nextCursor = (
  times: string[],
  limit: number,
  previous: LogCursor | null,
): LogCursor | null => {
  if (times.length < limit || times.length === 0) {
    return null;
  }

  const time = times[times.length - 1];
  let skip = 0;

  for (
    let index = times.length - 1;
    index >= 0 && times[index] === time;
    index -= 1
  ) {
    skip += 1;
  }

  // A page that is all one timestamp continues the previous skip.
  if (previous?.time === time) {
    skip += previous.skip;
  }

  return { time, skip };
};

/** One page of history, newest first, continuing after `cursor`. */
export const pageQuery = (
  namespace: string,
  filters: LogFilters,
  window: LogWindow,
  limit: number,
  cursor: LogCursor | null,
): string => {
  const parts = [
    filterQuery(namespace, filters),
    `_time:[${toRfc3339(window.start)}, ${toRfc3339(window.end)})`,
  ];

  if (cursor) {
    parts.push(`_time:<=${cursor.time}`);
  }

  // `_stream_id` breaks ties so `offset` skips the same lines every time.
  const offset = cursor && cursor.skip > 0 ? ` offset ${cursor.skip}` : '';

  return `${parts.join(' ')} | sort by (_time desc, _stream_id desc)${offset} limit ${limit} | fields ${ENTRY_FIELDS.join(', ')}`;
};

/** The live tail query: only lines newer than `since`, when given. */
export const tailQuery = (
  namespace: string,
  filters: LogFilters,
  since: string | null,
): string => {
  const base = filterQuery(namespace, filters);
  const timed = since ? `${base} _time:>${since}` : base;

  return `${timed} | fields ${ENTRY_FIELDS.join(', ')}`;
};

/** Lines and newest line per service and pod over the window. */
export const sourcesQuery = (namespace: string, window: LogWindow): string =>
  `{namespace=${quote(namespace)}} _time:[${toRfc3339(window.start)}, ${toRfc3339(window.end)})` +
  ' | stats by (workload_id, pod) count() lines, max(_time) last_seen' +
  ' | sort by (last_seen desc) | limit 1000';

/** Snaps the bucket width so a window shows about sixty bars. */
export const histogramStep = (window: LogWindow): number => {
  const target = (window.end - window.start) / 1000 / HISTOGRAM_BUCKETS;

  return (
    HISTOGRAM_STEPS.find((step) => step >= target) ??
    HISTOGRAM_STEPS[HISTOGRAM_STEPS.length - 1]
  );
};

const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' &&
  (LOG_LEVELS as readonly string[]).includes(value);

/**
 * Lays the per-level hit series on a full grid from `start` to `end` (unix
 * seconds, `start` aligned to `step`), so empty buckets show as zero bars.
 */
export const foldHistogram = (
  series: HitsSeries[],
  start: number,
  end: number,
  step: number,
): { buckets: LogHistogramBucket[]; total: number } => {
  const buckets: LogHistogramBucket[] = [];
  const byTime = new Map<number, LogHistogramBucket>();

  for (let time = start; time < end; time += step) {
    const bucket = { time, error: 0, warn: 0, info: 0, debug: 0, unknown: 0 };
    buckets.push(bucket);
    byTime.set(time, bucket);
  }

  let total = 0;

  for (const hit of series) {
    const level = hit.fields.level;
    const key = isLogLevel(level) ? level : 'unknown';

    hit.timestamps.forEach((timestamp, index) => {
      const seconds = Math.floor(Date.parse(timestamp) / 1000);
      const aligned = Math.floor(seconds / step) * step;
      const bucket = byTime.get(aligned);
      const value = hit.values[index] ?? 0;

      if (bucket) {
        bucket[key] += value;
        total += value;
      }
    });
  }

  return { buckets, total };
};

const nullable = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/** A stored record as the console sees it. */
export const toLogEntry = (record: LogRecord): ProjectLogEntry => {
  const stream = record.stream;

  return {
    id: `${record._stream_id ?? ''}:${record._time}`,
    time: record._time,
    message: record._msg ?? '',
    level: isLogLevel(record.level) ? record.level : null,
    stream: stream === 'stdout' || stream === 'stderr' ? stream : null,
    workload_id: nullable(record.workload_id),
    pod: record.pod ?? '',
    container: record.container ?? '',
  };
};
