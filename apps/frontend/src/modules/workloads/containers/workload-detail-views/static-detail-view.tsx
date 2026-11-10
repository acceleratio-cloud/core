import {
  History,
  LayoutDashboard,
  PanelsTopLeft,
  SlidersHorizontal,
} from 'lucide-react';

import type { StaticWorkloadConfig, Workload } from '@acceleratio/shared';
import { ViewLogsLink } from '@/modules/logs/components/view-logs-link';
import { DetailStack } from '@/modules/workloads/components/workload-details/detail-primitives';
import { DockerVersionDetails } from '../docker-version-details';
import { DockerWorkloadInstances } from '../docker-workload-instances';
import { EditDockerWorkloadConfig } from '../edit-docker-workload-config';
import { StaticSiteUpload } from '../static-site-upload';
import {
  WorkloadDeleteSection,
  WorkloadLifecycleActions,
} from '../workload-actions';
import { WorkloadVersions } from '../workload-versions';
import { configSummary } from './docker-detail-view';
import type { WorkloadDetailView } from './workload-detail-view';

/**
 * A static site runs as a Docker service with a fixed file server, so it
 * shares the Docker tabs without the image, environment and volumes; each
 * version serves one upload.
 */
export const getStaticDetailView = (
  workload: Workload,
): WorkloadDetailView => ({
  kindLabel: 'Static site',
  icon: (
    <PanelsTopLeft aria-hidden="true" strokeWidth={1.75} className="size-5" />
  ),
  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: (
        <DetailStack>
          <StaticSiteUpload />
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
        <DetailStack>
          <EditDockerWorkloadConfig />
          <WorkloadDeleteSection />
        </DetailStack>
      ),
    },
    {
      id: 'versions',
      label: 'Versions',
      icon: History,
      content: (
        <WorkloadVersions
          description="Each version serves one upload. Roll back to serve an earlier upload's files again, with the resources it had."
          renderDetails={(config) => <DockerVersionDetails config={config} />}
          renderConfig={(versionConfig) => {
            const config = versionConfig as StaticWorkloadConfig;
            const summary = configSummary({
              ...config,
              docker_image: '',
            });

            return (
              <>
                <span className="font-mono" title={config.release_id}>
                  upload {config.release_id?.slice(0, 8) ?? '—'}
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
