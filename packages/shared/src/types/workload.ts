export type WorkloadType = "docker" | "s3_bucket";

export type WorkloadStatus =
  | "draft"
  | "deploying"
  | "running"
  | "stopped"
  | "failed";

export interface WorkloadPosition {
  x: number;
  y: number;
}

/** One environment variable of a Docker service. */
export interface EnvVar {
  key: string;
  value: string;
}

export interface DockerWorkloadConfig {
  docker_image: string;
  /** CPU limit in vCPU (0.5 = 500m). Absent means 1 vCPU, null no limit. */
  cpu_max?: number | null;
  /** Memory limit in MiB. Absent means 1024 MiB, null no limit. */
  ram_max?: number | null;
  /** Pods the service runs, 1 to 10. Absent means 1. */
  replicas?: number;
  /** Replaces the image ENTRYPOINT. Absent keeps the image's own. */
  entrypoint?: string[];
  /** Replaces the image CMD. Absent keeps the image's own. */
  command?: string[];
  /**
   * Environment variables, in the order the user wrote them. Applied through a
   * Kubernetes Secret on deploy.
   *
   * Write-only: responses never carry values (see `env_keys` and
   * `WorkloadEnv`). In an update, an absent `env` keeps the current variables
   * and `[]` removes them all.
   */
  env?: EnvVar[];
  /**
   * Response-only: the variable names, in order, so lists and version history
   * can describe a config without exposing values. Ignored in requests.
   */
  env_keys?: string[];
}

/** The variables a Docker service is heading to: the draft's, else the active version's. */
export interface WorkloadEnv {
  env: EnvVar[];
}

/**
 * An S3 bucket in SeaweedFS. The bucket is named after the workload and its
 * storage profile is fixed when it is created.
 */
export interface S3BucketConfig {
  /** Storage profile whose replication, disk type and TTL the bucket uses. */
  storage_class_id: string;
}

export type WorkloadConfig = DockerWorkloadConfig | S3BucketConfig;

/** How a project workload reaches an S3 bucket. The secret key is separate. */
export interface S3BucketAccess {
  bucket: string;
  /** S3 endpoint inside the cluster. */
  endpoint: string;
  region: string;
  access_key_id: string;
  /** Kubernetes Secret in the project namespace that holds both keys. */
  secret_name: string;
}

/** Returned only on request, so the secret key is never part of a list. */
export interface S3BucketCredentials extends S3BucketAccess {
  secret_access_key: string;
}

/** One level of a bucket, as the console's explorer shows it. */
export interface S3BucketEntry {
  /** Last path segment: the file or folder name. */
  name: string;
  /** Object key from the bucket root; folders end with `/`. */
  path: string;
  kind: "folder" | "file";
  /** Bytes; null for folders. */
  size: number | null;
  content_type: string | null;
  modified_at: string | null;
}

export interface S3BucketListing {
  /** The folder listed, `""` for the bucket root, otherwise ending with `/`. */
  prefix: string;
  /** Folders first, then files, each by name. */
  entries: S3BucketEntry[];
  /** True when the folder holds more entries than one listing returns. */
  truncated: boolean;
}

export interface CreateS3FolderPayload {
  /** Folder key from the bucket root, with or without a trailing `/`. */
  path: string;
}

/** Immutable snapshot of a config that was applied to the cluster. */
export interface WorkloadVersion {
  id: string;
  workload_id: string;
  /** 1, 2, 3, … within one workload. */
  number: number;
  config: WorkloadConfig;
  /** The version a rollback copied its config from. */
  source_version_id: string | null;
  /** When the version was applied to the cluster. */
  created_at: string;
}

export interface Workload {
  id: string;
  project_id: string;
  name: string;
  type: WorkloadType;
  /** Version applied to the cluster; null until the first deploy. */
  active_version: WorkloadVersion | null;
  /** Changes that the next deploy applies; null when there are none. */
  draft_config: WorkloadConfig | null;
  position: WorkloadPosition;
  status: WorkloadStatus;
  status_message: string | null;
  /** When the stored status was last derived from the cluster. */
  status_observed_at: string | null;
  /** Deployment name in the cluster. Generated once, never changes. */
  external_name: string;
  /** Kubernetes namespace that holds the workload: `project-<project_id>`. */
  namespace: string;
  last_deployed_at: string | null;
  /** Set for `s3_bucket` workloads once their keys exist. */
  s3?: S3BucketAccess | null;
  created_at: string;
  updated_at: string;
}

export interface WorkloadStatusEvent {
  type: "status";
  workload_id: string;
  project_id: string;
  status: WorkloadStatus;
  status_message: string | null;
  status_observed_at: string | null;
  updated_at: string;
}

export interface WorkloadPositionEvent {
  type: "position";
  workload_id: string;
  project_id: string;
  position: WorkloadPosition;
  updated_at: string;
}

export type WorkloadEvent = WorkloadStatusEvent | WorkloadPositionEvent;

/** Lifecycle of one running copy (a Kubernetes Pod) of a Docker service. */
export type WorkloadInstanceStatus =
  | "running"
  | "starting"
  | "pending"
  | "terminating"
  | "failed"
  | "completed"
  | "unknown";

/** One running copy of a Docker service with its live resource usage. */
export interface WorkloadInstance {
  name: string;
  status: WorkloadInstanceStatus;
  /** Machine reason behind a non-running status, e.g. `CrashLoopBackOff`. */
  status_reason: string | null;
  status_message: string | null;
  ready: boolean;
  restarts: number;
  node: string | null;
  ip: string | null;
  /** The workload version the instance was started from. */
  version_id: string | null;
  created_at: string | null;
  started_at: string | null;
  /** Null when usage is unknown (no samples yet or metrics unavailable). */
  cpu_cores: number | null;
  /** Null when the instance runs without a CPU limit. */
  cpu_limit_cores: number | null;
  memory_bytes: number | null;
  memory_limit_bytes: number | null;
}

export interface WorkloadInstancesSnapshot {
  workload_id: string;
  /** Newest first; terminating instances last. */
  instances: WorkloadInstance[];
  /** False when VictoriaMetrics could not be reached for usage. */
  metrics_available: boolean;
  observed_at: string;
}

export interface CreateWorkloadPayload {
  name: string;
  type: WorkloadType;
  /** Required for `docker`; an `s3_bucket` without one uses the platform profile. */
  config?: WorkloadConfig;
}

export interface UpdateWorkloadPayload {
  name?: string;
  config?: WorkloadConfig;
  position?: WorkloadPosition;
}
