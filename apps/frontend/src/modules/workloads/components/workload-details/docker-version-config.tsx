import { Lock } from 'lucide-react';

import type { DockerWorkloadConfig } from '@acceleratio/shared';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  DEFAULT_REPLICAS,
  formatCpu,
  formatMemory,
  formatReplicas,
  formatVolumeSize,
} from '@/modules/workloads/utils/workload-config';
import {
  CopyableProperty,
  DetailSection,
  DetailStack,
  PropertyList,
  PropertyRow,
} from './detail-primitives';

const Muted = ({ children }: { children: string }) => (
  <span className="text-fg-tertiary">{children}</span>
);

const Args = ({ args }: { args: string[] | undefined }) =>
  args?.length ? (
    <span className="break-all">{JSON.stringify(args)}</span>
  ) : (
    <Muted>Image default</Muted>
  );

/**
 * Every setting of one Docker version, read-only. Variable values never
 * reach the console outside the Environment tab, so only names are listed.
 * Domains and the private hostname apply at once and are not versioned.
 */
export const DockerVersionConfig = ({
  config,
  profileName,
}: {
  config: DockerWorkloadConfig;
  /** Storage profile name by id; null is the platform profile. */
  profileName: (id: string | null) => string;
}) => {
  const labels = Object.entries(config.node_selector ?? {});
  const envKeys = config.env_keys ?? config.env?.map(({ key }) => key) ?? [];
  const volumes = config.volumes ?? [];

  return (
    <DetailStack>
      <DetailSection title="Image and command">
        <PropertyList>
          {/* A GitHub service's draft has no image before its first build. */}
          {config.docker_image ? (
            <CopyableProperty label="Image" value={config.docker_image} />
          ) : null}
          <PropertyRow label="Entrypoint" mono>
            <Args args={config.entrypoint} />
          </PropertyRow>
          <PropertyRow label="Command" mono>
            <Args args={config.command} />
          </PropertyRow>
        </PropertyList>
      </DetailSection>

      <DetailSection title="Resources">
        <PropertyList>
          <PropertyRow label="CPU limit" className="tabular-nums">
            {config.cpu_max === null ? (
              <Muted>No limit</Muted>
            ) : (
              formatCpu(config.cpu_max ?? DEFAULT_CPU_MAX)
            )}
          </PropertyRow>
          <PropertyRow label="Memory limit" className="tabular-nums">
            {config.ram_max === null ? (
              <Muted>No limit</Muted>
            ) : (
              formatMemory(config.ram_max ?? DEFAULT_RAM_MAX)
            )}
          </PropertyRow>
          <PropertyRow label="Replicas" className="tabular-nums">
            {formatReplicas(config.replicas ?? DEFAULT_REPLICAS)}
          </PropertyRow>
          <PropertyRow label="Node labels" mono>
            {labels.length ? (
              <span className="break-all">
                {labels.map(([key, value]) => `${key}=${value}`).join(', ')}
              </span>
            ) : (
              <Muted>Any node</Muted>
            )}
          </PropertyRow>
        </PropertyList>
      </DetailSection>

      <DetailSection title="Environment">
        {envKeys.length ? (
          <ul className="divide-y divide-edge-subtle">
            {envKeys.map((key, index) => (
              <li
                key={`${key}-${index}`}
                className="flex min-h-9 items-center gap-3 px-3 py-1.5 text-xs leading-5"
              >
                <span
                  className="min-w-0 flex-1 truncate font-mono text-fg-primary"
                  title={key}
                >
                  {key}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-fg-tertiary">
                  <Lock
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="size-3"
                  />
                  Value hidden
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs leading-5 text-fg-tertiary">
            No environment variables.
          </p>
        )}
      </DetailSection>

      <DetailSection title="Volumes">
        {volumes.length ? (
          <ul className="divide-y divide-edge-subtle">
            {volumes.map((volume) => (
              <li
                key={volume.id ?? volume.mount_path}
                className="flex min-h-9 items-center gap-3 px-3 py-1.5 text-xs leading-5"
              >
                <span
                  className="min-w-0 flex-1 truncate font-mono text-fg-primary"
                  title={volume.mount_path}
                >
                  {volume.mount_path}
                </span>
                <span className="shrink-0 text-fg-tertiary tabular-nums">
                  {formatVolumeSize(volume.size_gb)} ·{' '}
                  {profileName(volume.storage_class_id)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs leading-5 text-fg-tertiary">
            No volumes.
          </p>
        )}
      </DetailSection>

      <p className="px-1 text-xs leading-5 text-fg-tertiary">
        Domains and the private hostname apply at once and are not part of
        versions.
      </p>
    </DetailStack>
  );
};
