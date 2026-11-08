import { LayoutDashboard } from 'lucide-react';

import type { GithubWorkloadConfig, Workload } from '@acceleratio/shared';
import { GithubIcon } from '@/shared/icons/github-icon';
import { DetailStack } from '@/modules/workloads/components/workload-details/detail-primitives';
import { WorkloadIdentitySection } from '@/modules/workloads/components/workload-details/workload-common-sections';
import { WorkloadDeleteSection } from '../workload-actions';
import type { WorkloadDetailView } from './workload-detail-view';

/** Creation only for now: no deploy, versions or lifecycle actions yet. */
export const getGithubDetailView = (workload: Workload): WorkloadDetailView => {
  const config = workload.draft_config as GithubWorkloadConfig | null;

  return {
    kindLabel: 'GitHub',
    icon: <GithubIcon className="size-5 text-fg-tertiary" />,
    tabs: [
      {
        id: 'overview',
        label: 'Overview',
        icon: LayoutDashboard,
        content: (
          <DetailStack>
            <p className="text-sm text-muted-foreground">
              {config
                ? `Follows ${config.repository} on ${config.branch}. Deploying is not available yet.`
                : 'Deploying is not available yet.'}
            </p>
            <WorkloadIdentitySection workload={workload} />
            <WorkloadDeleteSection />
          </DetailStack>
        ),
      },
    ],
    headerActions: null,
  };
};
