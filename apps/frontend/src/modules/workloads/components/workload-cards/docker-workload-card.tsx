'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Activity, HardDrive, Package, Tag } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { parseDockerImage } from '@/modules/workloads/utils/parse-docker-image';
import {
  effectiveConfig,
  formatVolumeSize,
} from '@/modules/workloads/utils/workload-config';
import { DockerIcon } from '@/shared/icons/docker-icon';
import {
  NodeCard,
  NodeHeader,
  NodeNotice,
  NodeRow,
  NodeRows,
  WorkloadNodeFooter,
} from './node-card-primitives';
import { NodeDomainRow } from './node-domain-row';

export type DockerWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'docker'
>;

export const DockerWorkloadCard = ({
  data,
  selected,
}: NodeProps<DockerWorkloadNode>) => {
  const config = effectiveConfig(data);
  const reference = config.docker_image;
  const volumes = config.volumes ?? [];
  const totalSize = volumes.reduce((sum, volume) => sum + volume.size_gb, 0);
  const { repository, tag } = parseDockerImage(reference);

  return (
    <NodeCard selected={selected}>
      <NodeHeader
        icon={<DockerIcon className="size-4" />}
        title={data.name}
        status={data.status}
      />

      <NodeRows>
        <NodeRow icon={Activity} label="Status">
          <WorkloadStatus status={data.status} compact className="items-end" />
        </NodeRow>
        <NodeRow icon={Package} label="Image" title={reference}>
          {repository}
        </NodeRow>
        <NodeRow icon={Tag} label="Tag" title={tag}>
          {tag}
        </NodeRow>
        {volumes.length > 0 ? (
          <NodeRow
            icon={HardDrive}
            label={volumes.length === 1 ? 'Volume' : 'Volumes'}
            title={volumes
              .map(
                (volume) =>
                  `${volume.mount_path} (${formatVolumeSize(volume.size_gb)})`,
              )
              .join('\n')}
          >
            {volumes.length === 1
              ? volumes[0].mount_path
              : `${volumes.length} · ${formatVolumeSize(totalSize)}`}
          </NodeRow>
        ) : null}
        <NodeDomainRow workload={data} />
      </NodeRows>

      {data.status === 'failed' && data.status_message ? (
        <NodeNotice key={data.status_message}>{data.status_message}</NodeNotice>
      ) : null}

      <WorkloadNodeFooter workload={data} />
    </NodeCard>
  );
};
