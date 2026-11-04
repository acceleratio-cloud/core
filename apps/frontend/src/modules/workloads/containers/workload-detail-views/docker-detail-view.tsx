import { History, LayoutDashboard, SlidersHorizontal } from 'lucide-react';

import type { DockerWorkloadConfig, Workload } from '@acceleratio/shared';
import {
  DockerWorkloadConfiguration,
  DockerWorkloadOverview,
} from '@/modules/workloads/components/workload-details/docker-workload-overview';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  formatCpu,
  formatMemory,
} from '@/modules/workloads/utils/workload-config';
import { DockerIcon } from '@/shared/icons/docker-icon';
import {
  WorkloadDeleteSection,
  WorkloadLifecycleActions,
} from '../workload-actions';
import { EditDockerWorkloadConfig } from '../edit-docker-workload-config';
import { WorkloadVersions } from '../workload-versions';
import type { WorkloadDetailView } from './workload-detail-view';

/** What sets a version apart besides its image, or nothing at the defaults. */
const configSummary = (config: DockerWorkloadConfig) =>
  [
    config.cpu_max === null
      ? 'no CPU limit'
      : config.cpu_max !== undefined && config.cpu_max !== DEFAULT_CPU_MAX
        ? formatCpu(config.cpu_max)
        : null,
    config.ram_max === null
      ? 'no memory limit'
      : config.ram_max !== undefined && config.ram_max !== DEFAULT_RAM_MAX
        ? formatMemory(config.ram_max)
        : null,
    config.entrypoint || config.command ? 'custom command' : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
      content: (
        <DockerWorkloadConfiguration
          workload={workload}
          editor={<EditDockerWorkloadConfig />}
        >
          <WorkloadDeleteSection />
        </DockerWorkloadConfiguration>
      ),
    },
    {
      id: 'versions',
      label: 'Versions',
      icon: History,
      content: (
        <WorkloadVersions
          renderConfig={(config) => {
            const summary = configSummary(config);

            return (
              <>
                <span className="font-mono" title={config.docker_image}>
                  {config.docker_image}
                </span>
                {summary ? (
                  <span className="text-fg-tertiary"> · {summary}</span>
                ) : null}
              </>
            );
          }}
        />
      ),
    },
  ],
  headerActions: <WorkloadLifecycleActions />,
});
