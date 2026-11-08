import {
  History,
  KeyRound,
  LayoutDashboard,
  SlidersHorizontal,
} from 'lucide-react';

import type { GithubWorkloadConfig, Workload } from '@acceleratio/shared';
import { ViewLogsLink } from '@/modules/logs/components/view-logs-link';
import { DetailStack } from '@/modules/workloads/components/workload-details/detail-primitives';
import { DockerWorkloadConfiguration } from '@/modules/workloads/components/workload-details/docker-workload-overview';
import { GithubIcon } from '@/shared/icons/github-icon';
import {
  WorkloadDeleteSection,
  WorkloadLifecycleActions,
} from '../workload-actions';
import { DockerVersionDetails } from '../docker-version-details';
import { DockerWorkloadInstances } from '../docker-workload-instances';
import { EditDockerWorkloadConfig } from '../edit-docker-workload-config';
import { EditDockerWorkloadEnv } from '../edit-docker-workload-env';
import { GithubWorkloadBuilds } from '../github-workload-builds';
import { WorkloadVersions } from '../workload-versions';
import { configSummary } from './docker-detail-view';
import type { WorkloadDetailView } from './workload-detail-view';

/**
 * A GitHub service runs like a Docker service, so it shares its tabs; the
 * overview adds its builds and versions name the commit they run.
 */
export const getGithubDetailView = (
  workload: Workload,
): WorkloadDetailView => ({
  kindLabel: 'GitHub service',
  icon: <GithubIcon className="size-5" />,
  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: (
        <DetailStack>
          <GithubWorkloadBuilds />
          {workload.active_version ? (
            <DockerWorkloadInstances workload={workload} />
          ) : null}
        </DetailStack>
      ),
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
          description="Open a version to see its full configuration and compare it. Roll back restores the image built then, with its resources and environment; volumes and their data stay as they are."
          renderDetails={(config) => <DockerVersionDetails config={config} />}
          renderConfig={(versionConfig) => {
            const config = versionConfig as GithubWorkloadConfig;
            const summary = configSummary({
              ...config,
              docker_image: config.docker_image ?? '',
            });

            return (
              <>
                <span className="font-mono" title={config.commit_sha}>
                  {config.commit_sha?.slice(0, 7) ?? 'not built'}
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
