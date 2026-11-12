'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Activity, FolderGit2, GitBranch } from 'lucide-react';

import type { GithubWorkloadConfig, Workload } from '@acceleratio/shared';
import { GithubIcon } from '@/shared/icons/github-icon';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { internalAddress } from '@/modules/workloads/utils/internal-hostname';
import { WorkloadIcon } from '@/modules/workloads/components/workload-icon';
import {
  NodeCard,
  NodeHeader,
  NodeRow,
  NodeRows,
} from './node-card-primitives';
import { NodeVolumes } from './node-volumes';

export type GithubWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'github'
>;

export const GithubWorkloadCard = ({
  data,
  selected,
}: NodeProps<GithubWorkloadNode>) => {
  // The draft until the first deploy, then the applied config.
  const config = (data.draft_config ??
    data.active_version?.config ??
    null) as GithubWorkloadConfig | null;

  return (
    <NodeCard selected={selected}>
      <NodeHeader
        icon={
          <WorkloadIcon
            icon={data.icon}
            className="size-4"
            fallback={<GithubIcon className="size-4" />}
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
        <NodeRow
          icon={FolderGit2}
          label="Repository"
          title={config?.repository}
        >
          {config?.repository ?? '—'}
        </NodeRow>
        <NodeRow icon={GitBranch} label="Branch" title={config?.branch}>
          {config?.branch ?? '—'}
        </NodeRow>
      </NodeRows>

      <NodeVolumes workload={data} />
    </NodeCard>
  );
};
