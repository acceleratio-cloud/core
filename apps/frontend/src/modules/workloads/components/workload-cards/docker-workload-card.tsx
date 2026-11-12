'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Activity, Package, Tag } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { parseDockerImage } from '@/modules/workloads/utils/parse-docker-image';
import { effectiveConfig } from '@/modules/workloads/utils/workload-config';
import { DockerIcon } from '@/shared/icons/docker-icon';
import { internalAddress } from '@/modules/workloads/utils/internal-hostname';
import { WorkloadIcon } from '@/modules/workloads/components/workload-icon';
import {
  NodeCard,
  NodeHeader,
  NodeNotice,
  NodeRow,
  NodeRows,
  WorkloadNodeFooter,
} from './node-card-primitives';
import { NodeDomainRow } from './node-domain-row';
import { NodeVolumes } from './node-volumes';

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
  const { repository, tag } = parseDockerImage(reference);

  return (
    <NodeCard selected={selected}>
      <NodeHeader
        icon={
          <WorkloadIcon
            icon={data.icon}
            className="size-4"
            fallback={<DockerIcon className="size-4" />}
          />
        }
        title={data.name}
        subtitle={internalAddress(data)}
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
        <NodeDomainRow workload={data} />
      </NodeRows>

      <NodeVolumes workload={data} />

      {data.status === 'failed' && data.status_message ? (
        <NodeNotice key={data.status_message}>{data.status_message}</NodeNotice>
      ) : null}

      <WorkloadNodeFooter workload={data} />
    </NodeCard>
  );
};
