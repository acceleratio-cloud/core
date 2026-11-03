import { LayoutDashboard, Settings } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { DetailEmptyState } from '@/modules/workloads/components/workload-details/detail-primitives';
import { DockerWorkloadOverview } from '@/modules/workloads/components/workload-details/docker-workload-overview';
import { DockerIcon } from '@/shared/icons/docker-icon';
import { WorkloadActions } from '../workload-actions';
import type { WorkloadDetailView } from './workload-detail-view';

export const getDockerDetailView = (
  workload: Workload,
): WorkloadDetailView => ({
  kindLabel: 'Docker service',
  icon: <DockerIcon className="size-5" />,
  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: <DockerWorkloadOverview workload={workload} />,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      content: (
        <DetailEmptyState
          icon={Settings}
          title="No settings yet"
          description="Editable service settings will appear here."
        />
      ),
    },
  ],
  actions: <WorkloadActions workload={workload} />,
});
