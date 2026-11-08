import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import type { WorkloadType } from '@acceleratio/shared';
import type { DerivedWorkloadStatus } from './docker/docker-workload.status';

export interface WorkloadStatusSnapshot {
  deployment?: V1Deployment;
  pods: V1Pod[];
}

/**
 * Maps one cluster snapshot to a workload status. Each workload type owns a
 * deriver; the observer and the status service stay type-agnostic.
 */
export interface WorkloadStatusDeriver {
  readonly type: WorkloadType;
  /** May look up more of the cluster, such as events, before it decides. */
  derive(
    snapshot: WorkloadStatusSnapshot,
  ): DerivedWorkloadStatus | Promise<DerivedWorkloadStatus>;
}
