import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadType,
  WorkloadVersion,
  WorkloadVersionDiff,
} from '@acceleratio/shared';
import type { VersionAuthorInput } from './workload-version.service';

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
  /** `author` is recorded on the version the deploy creates, if any. */
  deploy(
    projectId: string,
    id: string,
    author?: VersionAuthorInput | null,
  ): Promise<Workload>;
  start(projectId: string, id: string): Promise<Workload>;
  stop(projectId: string, id: string): Promise<Workload>;
  restart(projectId: string, id: string): Promise<Workload>;
  remove(projectId: string, id: string): Promise<void>;
  rollback(
    projectId: string,
    id: string,
    versionId: string,
    author?: VersionAuthorInput | null,
  ): Promise<Workload>;
  listVersions(projectId: string, id: string): Promise<WorkloadVersion[]>;
  getVersion(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersion>;
  /**
   * What differs between two sides (`active`, `draft` or a version id),
   * computed on the server so every type answers in one shape. Secret values
   * are compared here and never returned.
   */
  diffVersions(
    projectId: string,
    id: string,
    base: string,
    target: string,
  ): Promise<WorkloadVersionDiff>;
  /** What a rollback to the version would change, before it runs. */
  previewRollback(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersionDiff>;
  discardDraft(projectId: string, id: string): Promise<Workload>;
}
