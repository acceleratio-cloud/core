'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Activity, Package, Tag } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { parseDockerImage } from '@/modules/workloads/utils/parse-docker-image';
import { DockerIcon } from '@/shared/icons/docker-icon';
import {
  NodeCard,
  NodeHeader,
  NodeNotice,
  NodeRow,
  NodeRows,
  WorkloadNodeFooter,
} from './node-card-primitives';

export type DockerWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'docker'
>;

export const DockerWorkloadCard = ({
  data,
  selected,
}: NodeProps<DockerWorkloadNode>) => {
  const reference = data.config.docker_image;
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
      </NodeRows>

      {data.status === 'failed' && data.status_message ? (
        <NodeNotice>{data.status_message}</NodeNotice>
      ) : null}

      <WorkloadNodeFooter workload={data} />
    </NodeCard>
  );
};
