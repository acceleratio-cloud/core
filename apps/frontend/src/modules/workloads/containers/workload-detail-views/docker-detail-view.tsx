import {
  History,
  KeyRound,
  LayoutDashboard,
  SlidersHorizontal,
} from 'lucide-react';

import type { DockerWorkloadConfig, Workload } from '@acceleratio/shared';
import { ViewLogsLink } from '@/modules/logs/components/view-logs-link';
import { DockerWorkloadConfiguration } from '@/modules/workloads/components/workload-details/docker-workload-overview';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  DEFAULT_REPLICAS,
  formatCpu,
  formatMemory,
  formatReplicas,
} from '@/modules/workloads/utils/workload-config';
import { DockerIcon } from '@/shared/icons/docker-icon';
import {
  WorkloadDeleteSection,
  WorkloadLifecycleActions,
} from '../workload-actions';
import { DockerWorkloadInstances } from '../docker-workload-instances';
import { EditDockerWorkloadConfig } from '../edit-docker-workload-config';
import { EditDockerWorkloadEnv } from '../edit-docker-workload-env';
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
    config.replicas !== undefined && config.replicas !== DEFAULT_REPLICAS
      ? formatReplicas(config.replicas)
      : null,
    config.entrypoint || config.command ? 'custom command' : null,
    config.volumes?.length
      ? `${config.volumes.length} ${config.volumes.length === 1 ? 'volume' : 'volumes'}`
      : null,
    config.env_keys?.length
      ? `${config.env_keys.length} env ${config.env_keys.length === 1 ? 'variable' : 'variables'}`
      : null,
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
      content: <DockerWorkloadInstances workload={workload} />,
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
      id: 'environment',
      label: 'Environment',
      icon: KeyRound,
      content: <EditDockerWorkloadEnv />,
    },
    {
      id: 'versions',
      label: 'Versions',
      icon: History,
      content: (
        <WorkloadVersions
          description="Roll back restores the image, command, resources and environment. Volumes and their data stay as they are."
          renderConfig={(versionConfig) => {
            // Versions of a Docker service hold Docker configs.
            const config = versionConfig as DockerWorkloadConfig;
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
  headerActions: (
    <WorkloadLifecycleActions
      leading={
        workload.status === 'draft' ? null : (
          <ViewLogsLink projectId={workload.project_id} service={workload.id} />
        )
      }
    />
  ),
});
