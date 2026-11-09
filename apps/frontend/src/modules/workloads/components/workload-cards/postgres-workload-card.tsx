'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Activity, Globe, HardDrive } from 'lucide-react';

import type { PostgresConfig, Workload } from '@acceleratio/shared';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { PostgresIcon } from '@/shared/icons/postgres-icon';
import {
  NodeCard,
  NodeHeader,
  NodeNotice,
  NodeRow,
  NodeRows,
} from './node-card-primitives';

export type PostgresWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'postgres'
>;

export const PostgresWorkloadCard = ({
  data,
  selected,
}: NodeProps<PostgresWorkloadNode>) => {
  const config = data.active_version?.config as PostgresConfig | undefined;

  return (
    <NodeCard selected={selected}>
      <NodeHeader
        icon={<PostgresIcon className="size-4" />}
        title={data.name}
        status={data.status}
      />

      <NodeRows>
        <NodeRow icon={Activity} label="Status">
          <WorkloadStatus status={data.status} compact className="items-end" />
        </NodeRow>
        <NodeRow icon={HardDrive} label="Version">
          {config
            ? `PostgreSQL ${config.postgres_version} · ${config.size_gb} GiB`
            : '—'}
        </NodeRow>
        <NodeRow icon={Globe} label="Host" title={data.postgres?.host}>
          {data.postgres
            ? `${data.external_name}-rw:${data.postgres.port}`
            : '—'}
        </NodeRow>
      </NodeRows>

      {data.status === 'failed' && data.status_message ? (
        <NodeNotice key={data.status_message}>{data.status_message}</NodeNotice>
      ) : null}
    </NodeCard>
  );
};
