/** Preset time windows of the project Logs tab, newest edge at "now". */
export const LOG_RANGES = ["15m", "1h", "6h", "24h", "7d"] as const;

export type LogRange = (typeof LOG_RANGES)[number];

/**
 * Levels Vector detects at ingestion (JSON `level`/`severity`, logfmt
 * `level=`, glog prefixes, or upper-case keywords such as `ERROR`).
 */
export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** A level filter also matches lines without a detected level. */
export const LOG_LEVEL_FILTERS = [...LOG_LEVELS, "unknown"] as const;

export type LogLevelFilter = (typeof LOG_LEVEL_FILTERS)[number];

/** Most entries one history page returns. */
export const MAX_LOG_PAGE_SIZE = 500;

/** Longest search text the API accepts. */
export const MAX_LOG_SEARCH_LENGTH = 256;

/** One line a container wrote, as stored in VictoriaLogs. */
export interface ProjectLogEntry {
  /** Stable within the store: stream id plus timestamp. */
  id: string;
  /** RFC 3339 with nanoseconds, UTC. */
  time: string;
  message: string;
  /** Null when no level was detected. */
  level: LogLevel | null;
  stream: "stdout" | "stderr" | null;
  /** The service the pod belonged to; null for pods without the label. */
  workload_id: string | null;
  pod: string;
  container: string;
}

/** A page of history, newest first. */
export interface ProjectLogsPage {
  entries: ProjectLogEntry[];
  /** Pass as `cursor` to read older entries; null at the end of the window. */
  next_cursor: string | null;
  /** The window the page was read from, RFC 3339. */
  start: string;
  end: string;
}

export interface LogHistogramBucket {
  /** Bucket start, unix seconds. */
  time: number;
  error: number;
  warn: number;
  info: number;
  debug: number;
  unknown: number;
}

/** Lines per level over the window, for the frequency chart. */
export interface ProjectLogHistogram {
  /** Unix seconds. */
  start: number;
  end: number;
  step_seconds: number;
  buckets: LogHistogramBucket[];
  total: number;
}

export interface LogSourcePod {
  name: string;
  /** The pod exists in the cluster now. */
  live: boolean;
  /** Lines in the window. */
  lines: number;
  /** Newest line in the window, RFC 3339; null when it wrote none. */
  last_seen: string | null;
}

export interface LogSourceWorkload {
  workload_id: string;
  /** Null for a service that has logs in the window but no longer exists. */
  name: string | null;
  lines: number;
  pods: LogSourcePod[];
}

/** Services and pods that can be filtered on, for the sidebar. */
export interface ProjectLogSources {
  workloads: LogSourceWorkload[];
}

/** Server-sent events of the live log stream. */
export type ProjectLogStreamEvent =
  | { type: "entries"; entries: ProjectLogEntry[] }
  /** Lines the stream skipped to stay under its rate limit. */
  | { type: "dropped"; count: number }
  /** The upstream stream ended; reconnect with `since`. */
  | { type: "error"; message: string }
  | { type: "heartbeat" };
