import type { Workload } from '@acceleratio/shared';

import { hasPendingChanges } from './workload-config';

/**
 * A deploy can start from a draft, a failed rollout, or a stopped service,
 * and from any status once a deployed service has pending changes.
 */
export const canDeployWorkload = (workload: Workload) =>
  workload.status === 'draft' ||
  workload.status === 'failed' ||
  workload.status === 'stopped' ||
  hasPendingChanges(workload);
