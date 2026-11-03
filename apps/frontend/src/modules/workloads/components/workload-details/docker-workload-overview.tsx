import type { Workload } from '@acceleratio/shared';
import { parseDockerImage } from '@/modules/workloads/utils/parse-docker-image';
import {
  CopyableProperty,
  DetailSection,
  DetailStack,
  MonoBadge,
  PropertyList,
} from './detail-primitives';
import {
  WorkloadDeploymentSection,
  WorkloadFailureNotice,
  WorkloadIdentitySection,
} from './workload-common-sections';

export const DockerWorkloadOverview = ({
  workload,
}: {
  workload: Workload;
}) => {
  const reference = workload.config.docker_image;
  const { repository, tag, digest } = parseDockerImage(reference);

  return (
    <DetailStack>
      <WorkloadFailureNotice workload={workload} />

      <div className="flex">
        <div>
          {/* Add usage charts here */}
          {/* Ads running pods list info here */}
        </div>
        <div className="space-y-6">
          <DetailSection title="Source">
            <PropertyList>
              <CopyableProperty label="Image" value={reference}>
                {repository}
              </CopyableProperty>
              <CopyableProperty label="Tag" value={tag}>
                <MonoBadge>{tag}</MonoBadge>
              </CopyableProperty>
              {digest ? (
                <CopyableProperty label="Digest" value={digest} />
              ) : null}
            </PropertyList>
          </DetailSection>

          <WorkloadDeploymentSection workload={workload} />
          <WorkloadIdentitySection workload={workload} />
        </div>
      </div>
    </DetailStack>
  );
};
