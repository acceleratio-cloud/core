import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadType,
  WorkloadVersion,
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
  rollback(projectId: string, id: string, versionId: string): Promise<Workload>;
  listVersions(projectId: string, id: string): Promise<WorkloadVersion[]>;
  getVersion(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersion>;
  discardDraft(projectId: string, id: string): Promise<Workload>;
}
