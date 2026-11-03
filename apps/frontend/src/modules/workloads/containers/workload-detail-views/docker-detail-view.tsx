import { LayoutDashboard, SlidersHorizontal } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import {
  DockerWorkloadConfiguration,
  DockerWorkloadOverview,
} from '@/modules/workloads/components/workload-details/docker-workload-overview';
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
      id: 'configuration',
      label: 'Configuration',
      icon: SlidersHorizontal,
      content: <DockerWorkloadConfiguration workload={workload} />,
    },
  ],
  actions: <WorkloadActions workload={workload} />,
});
