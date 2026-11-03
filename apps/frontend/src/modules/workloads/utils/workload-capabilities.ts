import type { WorkloadStatus } from '@acceleratio/shared';

/** A deploy can start from a draft, a failed rollout, or a stopped service. */
export const canDeployWorkload = (status: WorkloadStatus) =>
  status === 'draft' || status === 'failed' || status === 'stopped';
