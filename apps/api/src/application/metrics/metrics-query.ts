import {
  METRICS_RANGES,
  OTHER_METRICS_SERIES_KEY,
  type MetricsPoint,
  type MetricsRange,
  type MetricsSeries,
  type MetricsSignal,
} from '@acceleratio/shared';
import type { PromSeries } from '@/vendor/victoriametrics/victoriametrics.client';

interface RangeSpec {
  seconds: number;
  /** Resolution of the series; keeps every range at a few hundred points. */
  step: number;
}

const RANGE_SPECS: Record<MetricsRange, RangeSpec> = {
  '15m': { seconds: 15 * 60, step: 15 },
  '1h': { seconds: 60 * 60, step: 30 },
  '6h': { seconds: 6 * 60 * 60, step: 120 },
  '24h': { seconds: 24 * 60 * 60, step: 300 },
  '7d': { seconds: 7 * 24 * 60 * 60, step: 1800 },
};

/** Scrape interval of the bundled VictoriaMetrics config. */
const SCRAPE_INTERVAL_SECONDS = 15;

export const DEFAULT_METRICS_RANGE: MetricsRange = '1h';

export const isMetricsRange = (value: unknown): value is MetricsRange =>
  typeof value === 'string' &&
  (METRICS_RANGES as readonly string[]).includes(value);

export interface MetricsWindow {
  start: number;
  end: number;
  step: number;
  /** Lookbehind of `rate()`: at least four scrapes, and never below a step. */
  rateWindow: string;
}

/**
 * The query window for `range`, ending at `now` (unix seconds) and aligned
 * to the step so successive refreshes reuse the same timestamps.
 */
export const metricsWindow = (
  range: MetricsRange,
  now: number,
): MetricsWindow => {
  const { seconds, step } = RANGE_SPECS[range];
  const end = Math.floor(now / step) * step;

  return {
    start: end - seconds,
    end,
    step,
    rateWindow: `${Math.max(step, SCRAPE_INTERVAL_SECONDS * 4)}s`,
  };
};

/** Escapes a value for a PromQL double-quoted label matcher. */
const quote = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * PromQL for every per-pod signal of a namespace. Container series exclude
 * the pod-level aggregate (`container=""`) and the pause container; network
 * counters only exist at the pod level, so they keep it and drop loopback.
 */
export const projectQueries = (namespace: string, rateWindow: string) => {
  const ns = `namespace=${quote(namespace)}`;
  const containers = `${ns},container!="",container!="POD"`;
  const network = `${ns},interface!="lo"`;

  return {
    cpu_cores: `sum by (pod) (rate(container_cpu_usage_seconds_total{${containers}}[${rateWindow}]))`,
    memory_bytes: `sum by (pod) (container_memory_working_set_bytes{${containers}})`,
    network_rx_bytes_per_second: `sum by (pod) (rate(container_network_receive_bytes_total{${network}}[${rateWindow}]))`,
    network_tx_bytes_per_second: `sum by (pod) (rate(container_network_transmit_bytes_total{${network}}[${rateWindow}]))`,
    disk_read_bytes_per_second: `sum by (pod) (rate(container_fs_reads_bytes_total{${containers}}[${rateWindow}]))`,
    disk_write_bytes_per_second: `sum by (pod) (rate(container_fs_writes_bytes_total{${containers}}[${rateWindow}]))`,
  } as const;
};

export const volumeQueries = (namespace: string) => {
  const ns = `namespace=${quote(namespace)}`;

  return {
    used: `sum(kubelet_volume_stats_used_bytes{${ns}})`,
    capacity: `sum(kubelet_volume_stats_capacity_bytes{${ns}})`,
  } as const;
};

export interface WorkloadRef {
  id: string;
  name: string;
  /** Deployment name; pods are named `<external_name>-<hash>-<suffix>`. */
  external_name: string;
}

/**
 * Resolves which workload a pod belongs to. Live pods carry the workload id
 * label; pods that no longer exist (an older ReplicaSet, a restart in the
 * window) are matched on the longest `external_name-` prefix of their name.
 */
export const createPodResolver = (
  workloads: WorkloadRef[],
  livePodWorkloads: Map<string, string>,
): ((pod: string) => string | null) => {
  const known = new Set(workloads.map((workload) => workload.id));
  const prefixes = workloads
    .map((workload) => ({
      id: workload.id,
      prefix: `${workload.external_name}-`,
    }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  return (pod) => {
    const labelled = livePodWorkloads.get(pod);

    if (labelled && known.has(labelled)) {
      return labelled;
    }

    return prefixes.find(({ prefix }) => pod.startsWith(prefix))?.id ?? null;
  };
};

const toNumber = (value: string): number | null => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const addPoint = (
  target: Map<number, number>,
  timestamp: number,
  value: number,
) => {
  target.set(timestamp, (target.get(timestamp) ?? 0) + value);
};

const toPoints = (values: Map<number, number>): MetricsPoint[] =>
  [...values.entries()].sort(([a], [b]) => a - b);

/**
 * Folds per-pod range series into a project total and one series per
 * workload. Pods without a workload go to an `other` series. Workloads keep
 * the order of `workloads`; ones without samples are left out.
 */
export const foldSignal = (
  series: PromSeries[],
  workloads: WorkloadRef[],
  resolvePod: (pod: string) => string | null,
): MetricsSignal => {
  const total = new Map<number, number>();
  const byKey = new Map<string, Map<number, number>>();

  for (const item of series) {
    const key = resolvePod(item.metric.pod ?? '') ?? OTHER_METRICS_SERIES_KEY;
    let bucket = byKey.get(key);

    if (!bucket) {
      bucket = new Map();
      byKey.set(key, bucket);
    }

    for (const [timestamp, raw] of item.values ?? []) {
      const value = toNumber(raw);

      if (value === null) {
        continue;
      }

      addPoint(bucket, timestamp, value);
      addPoint(total, timestamp, value);
    }
  }

  const byWorkload: MetricsSeries[] = [];

  for (const workload of workloads) {
    const bucket = byKey.get(workload.id);

    if (bucket && bucket.size > 0) {
      byWorkload.push({
        key: workload.id,
        label: workload.name,
        points: toPoints(bucket),
      });
    }
  }

  const other = byKey.get(OTHER_METRICS_SERIES_KEY);

  if (other && other.size > 0) {
    byWorkload.push({
      key: OTHER_METRICS_SERIES_KEY,
      label: 'Other',
      points: toPoints(other),
    });
  }

  return { total: toPoints(total), by_workload: byWorkload };
};

/** The newest value of a series, or null when it has none. */
export const lastValue = (points: MetricsPoint[]): number | null =>
  points.length > 0 ? points[points.length - 1][1] : null;

/** The newest value of each series, keyed by its `key`. */
export const lastValues = (signal: MetricsSignal): Map<string, number> =>
  new Map(
    signal.by_workload.flatMap((series) => {
      const value = lastValue(series.points);

      return value === null ? [] : [[series.key, value] as const];
    }),
  );

/** The value of a scalar instant query (`sum(...)`), or null. */
export const scalarValue = (series: PromSeries[]): number | null => {
  const raw = series[0]?.value?.[1];

  return raw === undefined ? null : toNumber(raw);
};

const BINARY_SUFFIXES: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
};

const DECIMAL_SUFFIXES: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/**
 * Parses a Kubernetes resource quantity (`500m`, `2`, `512Mi`, `1G`,
 * `1e3`) into a plain number: cores for CPU, bytes for memory and storage.
 */
export const parseQuantity = (
  quantity: string | number | undefined | null,
): number | null => {
  if (quantity === undefined || quantity === null) {
    return null;
  }

  if (typeof quantity === 'number') {
    return Number.isFinite(quantity) ? quantity : null;
  }

  const match = /^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)([a-zA-Z]{0,2})$/.exec(
    quantity.trim(),
  );

  if (!match) {
    return null;
  }

  const [, amount, suffix] = match;
  const multiplier = BINARY_SUFFIXES[suffix] ?? DECIMAL_SUFFIXES[suffix];

  if (multiplier === undefined) {
    return null;
  }

  return Number(amount) * multiplier;
};
