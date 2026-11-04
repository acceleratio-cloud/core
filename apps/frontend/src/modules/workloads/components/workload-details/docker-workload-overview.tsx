import type { ReactNode } from 'react';
import { Cpu, Package, TerminalSquare } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { parseDockerImage } from '@/modules/workloads/utils/parse-docker-image';
import { formatShellArgs } from '@/modules/workloads/utils/shell-args';
import {
  effectiveConfig,
  formatCpuLimit,
  formatMemoryLimit,
} from '@/modules/workloads/utils/workload-config';
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
} from './workload-common-sections';

/**
 * The error if there is one, a glance at the image, resources and process,
 * and the history.
 */
export const DockerWorkloadOverview = ({
  workload,
}: {
  workload: Workload;
}) => {
  const config = effectiveConfig(workload);
  const reference = config.docker_image;
  const { repository, tag } = parseDockerImage(reference);
  const hasProcess = Boolean(config.entrypoint || config.command);

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

      <DetailSection title="Resources" icon={Cpu}>
        <PropertyList>
          <PropertyRow label="CPU limit">
            {formatCpuLimit(config.cpu_max)}
          </PropertyRow>
          <PropertyRow label="Memory limit">
            {formatMemoryLimit(config.ram_max)}
          </PropertyRow>
        </PropertyList>
      </DetailSection>

      {hasProcess ? (
        <DetailSection title="Process" icon={TerminalSquare}>
          <PropertyList>
            {config.entrypoint ? (
              <CopyableProperty
                label="Entrypoint"
                value={formatShellArgs(config.entrypoint)}
              />
            ) : null}
            {config.command ? (
              <CopyableProperty
                label="Command"
                value={formatShellArgs(config.command)}
              />
            ) : null}
          </PropertyList>
        </DetailSection>
      ) : null}

      <WorkloadDeploymentSection workload={workload} />
    </DetailStack>
  );
};

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
        <DetailSection title="Image digest" icon={Package}>
          <PropertyList>
            <CopyableProperty label="Digest" value={digest} />
          </PropertyList>
        </DetailSection>
      ) : null}

      {children}
    </DetailStack>
  );
};
