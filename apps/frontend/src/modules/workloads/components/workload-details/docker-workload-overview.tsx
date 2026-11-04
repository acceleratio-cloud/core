import type { ReactNode } from 'react';
import { Cpu, Package, TerminalSquare } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { parseDockerImage } from '@/modules/workloads/utils/parse-docker-image';
import { formatShellArgs } from '@/modules/workloads/utils/shell-args';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  effectiveConfig,
  formatCpu,
  formatMemory,
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
  WorkloadIdentitySection,
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
            {formatCpu(config.cpu_max ?? DEFAULT_CPU_MAX)}
          </PropertyRow>
          <PropertyRow label="Memory limit">
            {formatMemory(config.ram_max ?? DEFAULT_RAM_MAX)}
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
 * The editable container settings, then everything that identifies the
 * service, in full and copyable. `editor` and `children` are controls the
 * view owns: the config form first, delete after the sections.
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

      <WorkloadIdentitySection workload={workload} />
      {children}
    </DetailStack>
  );
};
