import type { WorkloadStatus, WorkloadType } from "./workload";

/** Time ranges the project Observability tab can show. */
export const METRICS_RANGES = ["15m", "1h", "6h", "24h", "7d"] as const;

export type MetricsRange = (typeof METRICS_RANGES)[number];

/** `[unix seconds, value]`, aligned to the response's `step_seconds`. */
export type MetricsPoint = [number, number];

/** Key of the series for pods that do not belong to a known workload. */
export const OTHER_METRICS_SERIES_KEY = "other";

export interface MetricsSeries {
  /** Workload id, or `other` for pods without a known workload. */
  key: string;
  label: string;
  points: MetricsPoint[];
}

/** A project total plus the same signal split by workload. */
export interface MetricsSignal {
  total: MetricsPoint[];
  by_workload: MetricsSeries[];
}

export interface ProjectMetricsSummary {
  /** CPU in use now, in cores. Null when there is no sample. */
  cpu_cores: number | null;
  /** Sum of container CPU limits; null when any running container has none. */
  cpu_limit_cores: number | null;
  /** Memory working set now, in bytes. */
  memory_bytes: number | null;
  /** Sum of container memory limits; null when any running container has none. */
  memory_limit_bytes: number | null;
  /** Bytes used on the project's volumes (kubelet volume stats). */
  disk_used_bytes: number | null;
  /** Capacity of the project's volumes; falls back to the PVC requests. */
  disk_capacity_bytes: number | null;
  /** Network receive and transmit rates, in bytes per second. */
  network_rx_bytes_per_second: number | null;
  network_tx_bytes_per_second: number | null;
  pods_ready: number;
  pods_total: number;
  /** Container restarts across the pods that exist now. */
  restarts: number;
}

export interface WorkloadMetrics {
  workload_id: string;
  name: string;
  type: WorkloadType;
  status: WorkloadStatus;
  pods_ready: number;
  pods_total: number;
  restarts: number;
  cpu_cores: number | null;
  cpu_limit_cores: number | null;
  memory_bytes: number | null;
  memory_limit_bytes: number | null;
  network_rx_bytes_per_second: number | null;
  network_tx_bytes_per_second: number | null;
}

export interface ClusterCapacity {
  cpu_cores: number;
  memory_bytes: number;
}

/**
 * PostgreSQL databases of the project, from their CloudNativePG exporter:
 * one series per database. Empty lists when the project has none.
 */
export interface PostgresMetrics {
  /** Client connections, the exporter's own left out. */
  connections: MetricsSeries[];
  transactions_per_second: MetricsSeries[];
  /** Share of block reads served from shared buffers, 0 to 1. */
  cache_hit_ratio: MetricsSeries[];
  /** Size of the application database, in bytes. */
  database_size_bytes: MetricsSeries[];
}

export interface ProjectMetrics {
  range: MetricsRange;
  /** Window of the series, in unix seconds. */
  start: number;
  end: number;
  step_seconds: number;
  /** Allocatable capacity of the cluster's nodes. */
  cluster: ClusterCapacity | null;
  summary: ProjectMetricsSummary;
  series: {
    cpu_cores: MetricsSignal;
    memory_bytes: MetricsSignal;
    network_rx_bytes_per_second: MetricsSignal;
    network_tx_bytes_per_second: MetricsSignal;
    disk_read_bytes_per_second: MetricsSignal;
    disk_write_bytes_per_second: MetricsSignal;
  };
  workloads: WorkloadMetrics[];
  postgres: PostgresMetrics;
}
