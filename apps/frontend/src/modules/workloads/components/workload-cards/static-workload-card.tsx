'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Activity, FileUp, PanelsTopLeft } from 'lucide-react';

import type { StaticWorkloadConfig, Workload } from '@acceleratio/shared';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
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

export type StaticWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'static'
>;

export const StaticWorkloadCard = ({
  data,
  selected,
}: NodeProps<StaticWorkloadNode>) => {
  const live = data.active_version?.config as StaticWorkloadConfig | undefined;

  return (
    <NodeCard selected={selected}>
      <NodeHeader
        icon={
          <WorkloadIcon
            icon={data.icon}
            className="size-4"
            fallback={
              <PanelsTopLeft
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-4"
              />
            }
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
        <NodeRow icon={FileUp} label="Files">
          {live?.release_id
            ? `v${data.active_version?.number}`
            : 'Not uploaded'}
        </NodeRow>
        <NodeDomainRow workload={data} />
      </NodeRows>

      {data.status === 'failed' && data.status_message ? (
        <NodeNotice key={data.status_message}>{data.status_message}</NodeNotice>
      ) : null}

      <WorkloadNodeFooter workload={data} />
    </NodeCard>
  );
};
