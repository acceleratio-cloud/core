import type { ReactNode } from 'react';

import type { Workload } from '@acceleratio/shared';
import { parseDockerImage } from '@/modules/workloads/utils/parse-docker-image';
import { effectiveConfig } from '@/modules/workloads/utils/workload-config';
import {
  CopyableProperty,
  DetailSection,
  DetailStack,
  PropertyList,
} from './detail-primitives';

/**
 * The editable settings, then the image digest when there is one. `editor`
 * and `children` are controls the view owns: the config form first, delete
 * last.
 */
export const DockerWorkloadConfiguration = ({
  workload,
  editor,
  children,
}: {
  workload: Workload;
  editor?: ReactNode;
  children?: ReactNode;
}) => {
  const { digest } = parseDockerImage(effectiveConfig(workload).docker_image);

  return (
    <DetailStack>
      {editor}

      {digest ? (
        <DetailSection title="Image digest">
          <PropertyList>
            <CopyableProperty label="Digest" value={digest} />
          </PropertyList>
        </DetailSection>
      ) : null}

      {children}
    </DetailStack>
  );
};
