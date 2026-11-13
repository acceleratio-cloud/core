/**
 * `platform` is the StorageClass created by the installer (read-only).
 * `custom` classes are created and owned by the console.
 */
export type StorageClassKind = 'platform' | 'custom';

export type StorageClassReclaimPolicy = 'Delete' | 'Retain';

export type StorageClassVolumeBindingMode =
  'Immediate' | 'WaitForFirstConsumer';

/**
 * How the stored class compares with the object in the cluster.
 * `unknown` means the cluster could not be reached.
 */
export type StorageClassClusterStatus =
  'ready' | 'missing' | 'drifted' | 'unknown';

/**
 * Where Longhorn keeps a copy relative to the pod that uses the volume.
 * `disabled`: anywhere; `best-effort`: one copy on the pod's server when it
 * can; `strict-local`: one copy, always on the pod's server.
 */
export type StorageClassDataLocality =
  'disabled' | 'best-effort' | 'strict-local';

export type StorageClassFsType = 'ext4' | 'xfs';

/**
 * Longhorn volume settings. Every field maps to one StorageClass parameter
 * of the `driver.longhorn.io` provisioner.
 */
export interface StorageClassParameters {
  /** Copies of each volume, each on a different server (1–3). */
  number_of_replicas: number;
  data_locality: StorageClassDataLocality;
  fs_type: StorageClassFsType;
  /** Longhorn disk tags a copy's disk must have; null allows any disk. */
  disk_selector: string[] | null;
  /** Longhorn node tags a copy's server must have; null allows any server. */
  node_selector: string[] | null;
}

export interface StorageClass {
  id: string;
  kind: StorageClassKind;
  name: string;
  description: string | null;
  /** StorageClass name in Kubernetes. Generated once, never changes. */
  external_name: string;
  provisioner: string;
  is_default: boolean;
  /** False for the platform class; true for custom classes. */
  editable: boolean;
  /** Null for a platform class the cluster does not report. */
  parameters: StorageClassParameters | null;
  /** Driver parameters outside the console's set (platform class only). */
  extra_parameters: Record<string, string>;
  reclaim_policy: StorageClassReclaimPolicy | null;
  volume_binding_mode: StorageClassVolumeBindingMode | null;
  allow_volume_expansion: boolean;
  cluster_status: StorageClassClusterStatus;
  /** PersistentVolumes using the class; null when the cluster is unreachable. */
  volume_count: number | null;
  /** Most recent benchmark run, or null when the class was never benchmarked. */
  latest_benchmark: StorageBenchmark | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStorageClassPayload {
  name: string;
  description?: string | null;
  parameters?: Partial<StorageClassParameters>;
  reclaim_policy?: StorageClassReclaimPolicy;
  volume_binding_mode?: StorageClassVolumeBindingMode;
  allow_volume_expansion?: boolean;
}

/** Only these fields can change after creation. */
export interface UpdateStorageClassPayload {
  name?: string;
  description?: string | null;
  allow_volume_expansion?: boolean;
}

export interface StorageEnvironment {
  /** Longhorn's CSI driver; false on a development cluster (local-path). */
  csi_driver_installed: boolean | null;
  /** Servers Longhorn may place copies on (Ready, scheduling allowed); null when unknown. */
  storage_nodes: number | null;
}

export type StorageBenchmarkStatus =
  'pending' | 'running' | 'succeeded' | 'failed';

/** fio results; IOPS are operations per second, throughput is MB/s. */
export interface StorageBenchmarkResults {
  random_read_iops: number;
  random_write_iops: number;
  sequential_read_mbps: number;
  sequential_write_mbps: number;
  /**
   * Mean latency of single small reads and writes, in milliseconds: the
   * queue-depth-1 tests since method 2, the random tests before.
   */
  random_read_latency_ms: number;
  random_write_latency_ms: number;
}

export type StorageBenchmarkTestName =
  | 'sequential-write'
  | 'sequential-read'
  | 'random-write'
  | 'random-read'
  | 'random-write-latency'
  | 'random-read-latency';

/** One point of a test's progress, averaged over about a second. */
export interface StorageBenchmarkPoint {
  /** Seconds since the test started. */
  t: number;
  iops: number;
  mbps: number;
  latency_ms: number;
}

export interface StorageBenchmarkTest {
  name: StorageBenchmarkTestName;
  label: string;
  pattern: 'sequential' | 'random';
  direction: 'read' | 'write';
  parameters: {
    block_size: string;
    jobs: number;
    /** Requests in flight per job; absent for runs before method 2. */
    io_depth?: number;
    engine: string;
    direct: boolean;
    file_size: string;
    /** What ends the test, such as "15 s" or "64 MiB per job". */
    limit: string;
  };
  iops: number;
  bandwidth_mbps: number;
  latency_ms: {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    p999: number;
    max: number;
  };
  runtime_seconds: number;
  io_mb: number;
  /** fio's error number; 0 when the test ran cleanly. */
  error_code: number;
  /** At most 120 points; longer tests are averaged into wider buckets. */
  series: StorageBenchmarkPoint[];
}

export interface StorageBenchmarkProgress {
  current_test: StorageBenchmarkTestName | null;
  completed: number;
  total: number;
}

/** Profile settings when the run started. */
export interface StorageBenchmarkProfileSnapshot {
  external_name: string;
  parameters: StorageClassParameters | null;
  reclaim_policy: StorageClassReclaimPolicy | null;
  volume_binding_mode: StorageClassVolumeBindingMode | null;
  allow_volume_expansion: boolean;
}

export interface StorageBenchmarkEnvironment {
  nodes: number | null;
  storage_nodes: number | null;
  kubernetes_version: string | null;
  /** How the run measured; absent for method 1 (buffered I/O, SeaweedFS era). */
  method?: number;
  /** Server the test pod ran on, read when the run ended. */
  pod_node?: string | null;
  /** Servers holding Longhorn copies of the test volume when the run ended. */
  replica_nodes?: string[] | null;
}

export interface StorageBenchmark {
  id: string;
  /** Null when the profile has been deleted since the run. */
  storage_class_id: string | null;
  /** Profile name when the run started. */
  storage_class_name: string;
  status: StorageBenchmarkStatus;
  status_message: string | null;
  results: StorageBenchmarkResults | null;
  /** Measurement method; results compare only within one method. */
  method: number;
  /** Step that failed: install, provision, start, or a test name. */
  failed_step: string | null;
  /** Test-by-test progress; null for runs recorded before reports. */
  progress: StorageBenchmarkProgress | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

/** A page of benchmark history, newest first. */
export interface StorageBenchmarkHistory {
  items: StorageBenchmark[];
  /** Pass as `before` to load older runs; null on the last page. */
  next_before: string | null;
}

/** A previous run of the same profile, for comparison. */
export interface StorageBenchmarkComparison {
  id: string;
  created_at: string;
  results: StorageBenchmarkResults | null;
  tests: Omit<StorageBenchmarkTest, 'series'>[];
}

export interface StorageBenchmarkReport extends StorageBenchmark {
  tests: StorageBenchmarkTest[];
  profile_snapshot: StorageBenchmarkProfileSnapshot | null;
  environment: StorageBenchmarkEnvironment | null;
  previous: StorageBenchmarkComparison | null;
}
