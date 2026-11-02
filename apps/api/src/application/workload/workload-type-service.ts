import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadType,
} from '@acceleratio/shared';

/**
 * The complete surface of one workload type. A type owns its rows, its
 * Kubernetes objects and its mapping to the API contract; the facade only
 * chooses a service and delegates.
 */
export interface WorkloadTypeService {
  readonly type: WorkloadType;

  list(projectId: string): Promise<Workload[]>;
  create(projectId: string, payload: CreateWorkloadPayload): Promise<Workload>;
  get(projectId: string, id: string): Promise<Workload>;
  update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload>;
  deploy(projectId: string, id: string): Promise<Workload>;
  start(projectId: string, id: string): Promise<Workload>;
  stop(projectId: string, id: string): Promise<Workload>;
  restart(projectId: string, id: string): Promise<Workload>;
  remove(projectId: string, id: string): Promise<void>;
}
