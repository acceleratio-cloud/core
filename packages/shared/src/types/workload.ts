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

export interface DockerWorkloadConfig {
  docker_image: string;
  /** CPU limit in vCPU (0.5 = 500m). Absent means 1 vCPU, null no limit. */
  cpu_max?: number | null;
  /** Memory limit in MiB. Absent means 1024 MiB, null no limit. */
  ram_max?: number | null;
  /** Replaces the image ENTRYPOINT. Absent keeps the image's own. */
  entrypoint?: string[];
  /** Replaces the image CMD. Absent keeps the image's own. */
  command?: string[];
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
