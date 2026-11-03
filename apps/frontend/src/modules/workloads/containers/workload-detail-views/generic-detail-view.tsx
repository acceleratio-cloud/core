import { Box, LayoutDashboard, SlidersHorizontal } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { DetailStack } from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  WorkloadDeploymentSection,
  WorkloadFailureNotice,
  WorkloadIdentitySection,
} from '@/modules/workloads/components/workload-details/workload-common-sections';
import { WorkloadActions } from '../workload-actions';
import type { WorkloadDetailView } from './workload-detail-view';

/**
 * Fallback for a type the console does not know yet (for example an API
 * newer than the bundle). It shows only the fields every workload has.
 */
export const getGenericDetailView = (
  workload: Workload,
): WorkloadDetailView => ({
  kindLabel: 'Service',
  icon: (
    <Box
      aria-hidden="true"
      strokeWidth={1.75}
      className="size-5 text-fg-tertiary"
    />
  ),
  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: (
        <DetailStack>
          <WorkloadFailureNotice workload={workload} />
          <WorkloadDeploymentSection workload={workload} />
        </DetailStack>
      ),
    },
    {
      id: 'configuration',
      label: 'Configuration',
      icon: SlidersHorizontal,
      content: (
        <DetailStack>
          <WorkloadIdentitySection workload={workload} />
        </DetailStack>
      ),
    },
  ],
  actions: <WorkloadActions workload={workload} />,
});
