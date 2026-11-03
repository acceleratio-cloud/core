export type WorkloadType = "docker";

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
}

export type WorkloadConfig = DockerWorkloadConfig;

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
  config: WorkloadConfig;
}

export interface UpdateWorkloadPayload {
  name?: string;
  config?: WorkloadConfig;
  position?: WorkloadPosition;
}
