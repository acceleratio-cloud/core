import type { Workload, WorkloadConfig } from '@acceleratio/shared';

/**
 * The config the service is heading to: pending changes when there are any,
 * otherwise what the cluster runs. Every workload has at least one of them.
 */
export const effectiveConfig = (workload: Workload): WorkloadConfig =>
  (workload.draft_config ?? workload.active_version?.config)!;

/** Edits on a deployed service that the next deploy applies. */
export const hasPendingChanges = (workload: Workload) =>
  workload.draft_config !== null && workload.active_version !== null;
