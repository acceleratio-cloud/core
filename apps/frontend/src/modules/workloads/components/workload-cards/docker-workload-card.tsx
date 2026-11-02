'use client';

import type { Node, NodeProps } from '@xyflow/react';

import type { Workload } from '@acceleratio/shared';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { DockerIcon } from '@/shared/icons/docker-icon';

export type DockerWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'docker'
>;

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const formatDate = (value: string) => dateFormatter.format(new Date(value));

export const DockerWorkloadCard = ({ data }: NodeProps<DockerWorkloadNode>) => (
  <div className="w-[240px] overflow-hidden rounded-lg border border-border bg-card p-3">
    <div className="flex items-center gap-2.5">
      <DockerIcon className="size-6" />

      <div className="min-w-0 flex-1 space-y-0.5">
        <div
          title={data.name}
          className="truncate text-sm leading-none font-medium tracking-tight text-foreground"
        >
          {data.name}
        </div>
        <div
          title={data.config.docker_image}
          className="truncate text-xs text-muted-foreground"
        >
          {data.config.docker_image}
        </div>
      </div>
    </div>

    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
      <WorkloadStatus status={data.status} compact className="min-w-0" />

      <span className="shrink-0 truncate text-[10px] leading-none text-muted-foreground tabular-nums">
        {data.last_deployed_at ? (
          <time dateTime={data.last_deployed_at} title={data.last_deployed_at}>
            Deployed {formatDate(data.last_deployed_at)}
          </time>
        ) : (
          'Never deployed'
        )}
      </span>
    </div>
  </div>
);
