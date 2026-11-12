'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Activity, Plug, Tag } from 'lucide-react';

import type { PostgresConfig, Workload } from '@acceleratio/shared';
import { useProject } from '@/modules/projects/providers/project-provider';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { volumeFill } from '@/modules/workloads/utils/volume-usage';
import { PostgresIcon } from '@/shared/icons/postgres-icon';
import { internalAddress } from '@/modules/workloads/utils/internal-hostname';
import { WorkloadIcon } from '@/modules/workloads/components/workload-icon';
import {
  NodeCard,
  NodeHeader,
  NodeNotice,
  NodeRow,
  NodeRows,
} from './node-card-primitives';
import { DiskFullNotice, DiskTile } from './node-volumes';

export type PostgresWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'postgres'
>;

export const PostgresWorkloadCard = ({
  data,
  selected,
}: NodeProps<PostgresWorkloadNode>) => {
  const config = data.active_version?.config as PostgresConfig | undefined;
  const { volumeUsage } = useProject();
  const fill = config
    ? volumeFill(config.size_gb, volumeUsage.get(data.id))
    : null;

  return (
    <NodeCard selected={selected}>
      <NodeHeader
        icon={
          <WorkloadIcon
            icon={data.icon}
            className="size-4"
            fallback={<PostgresIcon className="size-4" />}
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
        <NodeRow icon={Tag} label="Version">
          {config ? `PostgreSQL ${config.postgres_version}` : '—'}
        </NodeRow>
        <NodeRow icon={Plug} label="Port" title={data.postgres?.host}>
          {data.postgres?.port ?? '—'}
        </NodeRow>
      </NodeRows>

      {config ? (
        <ul aria-label="Disk" className="mx-3 mb-3">
          <DiskTile label="Data" sizeGb={config.size_gb} fill={fill} showFree />
        </ul>
      ) : null}

      {fill && fill.level !== 'ok' ? (
        <DiskFullNotice
          subject="The database disk"
          fill={fill}
          title="Disk almost full"
        />
      ) : null}

      {data.status === 'failed' && data.status_message ? (
        <NodeNotice key={data.status_message}>{data.status_message}</NodeNotice>
      ) : null}
    </NodeCard>
  );
};
