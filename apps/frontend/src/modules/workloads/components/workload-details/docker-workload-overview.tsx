import type { ReactNode } from 'react';
import { Package } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { parseDockerImage } from '@/modules/workloads/utils/parse-docker-image';
import { effectiveConfig } from '@/modules/workloads/utils/workload-config';
import {
  CopyableProperty,
  DetailSection,
  DetailStack,
  MonoBadge,
  PropertyList,
  PropertyRow,
} from './detail-primitives';
import {
  WorkloadDeploymentSection,
  WorkloadFailureNotice,
  WorkloadIdentitySection,
} from './workload-common-sections';

/** The error if there is one, a glance at the image, and the history. */
export const DockerWorkloadOverview = ({
  workload,
}: {
  workload: Workload;
}) => {
  const reference = effectiveConfig(workload).docker_image;
  const { repository, tag } = parseDockerImage(reference);

  return (
    <DetailStack>
      <WorkloadFailureNotice workload={workload} />

      <DetailSection title="Image" icon={Package}>
        <PropertyList>
          <PropertyRow label="Repository" mono>
            <span title={reference} className="block truncate">
              {repository}
            </span>
          </PropertyRow>
          <PropertyRow label="Tag">
            <MonoBadge>{tag}</MonoBadge>
          </PropertyRow>
        </PropertyList>
      </DetailSection>

      <WorkloadDeploymentSection workload={workload} />
    </DetailStack>
  );
};

/**
 * Everything that identifies the service, in full and copyable. `children`
 * render after the sections, for controls the view owns (such as delete).
 */
export const DockerWorkloadConfiguration = ({
  workload,
  children,
}: {
  workload: Workload;
  children?: ReactNode;
}) => {
  const reference = effectiveConfig(workload).docker_image;
  const { digest } = parseDockerImage(reference);

  return (
    <DetailStack>
      <DetailSection title="Container image" icon={Package}>
        <PropertyList>
          <CopyableProperty label="Image" value={reference} />
          {digest ? <CopyableProperty label="Digest" value={digest} /> : null}
        </PropertyList>
      </DetailSection>

      <WorkloadIdentitySection workload={workload} />
      {children}
    </DetailStack>
  );
};
