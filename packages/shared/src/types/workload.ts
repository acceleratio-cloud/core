export type WorkloadType = "docker";

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
  projectId: string;
  name: string;
  type: WorkloadType;
  config: WorkloadConfig;
  position: WorkloadPosition;
  createdAt: string;
  updatedAt: string;
}

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
