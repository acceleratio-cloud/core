import type { Workload } from '@acceleratio/shared';

import { hasPendingChanges } from './workload-config';

export interface DeployAction {
  label: string;
  pendingLabel: string;
}

/**
 * What the deploy action means for this service right now, or null when it
 * has nothing to do:
 * - never deployed: Deploy its first version (unless that rollout is running);
 * - deployed with pending changes: Apply changes, from any status;
 * - a failed rollout with no pending changes: Redeploy the active version.
 * A stopped service with no pending changes is brought back with Start.
 */
export const deployAction = (workload: Workload): DeployAction | null => {
  if (workload.active_version === null) {
    return workload.status === 'deploying'
      ? null
      : { label: 'Deploy', pendingLabel: 'Deploying' };
  }

  if (hasPendingChanges(workload)) {
    return { label: 'Apply changes', pendingLabel: 'Applying' };
  }

  if (workload.status === 'failed') {
    return { label: 'Redeploy', pendingLabel: 'Redeploying' };
  }

  return null;
};
