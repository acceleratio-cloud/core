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

export interface Workload {
  id: string;
  project_id: string;
  name: string;
  type: WorkloadType;
  config: WorkloadConfig;
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
