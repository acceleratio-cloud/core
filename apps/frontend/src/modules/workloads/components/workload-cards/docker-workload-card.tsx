'use client';

import type { Node, NodeProps } from '@xyflow/react';

import type { Workload } from '@acceleratio/shared';
import { DockerIcon } from '@/shared/icons/docker-icon';

export type DockerWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'docker'
>;

export const DockerWorkloadCard = ({ data }: NodeProps<DockerWorkloadNode>) => (
  <div className="w-[240px] overflow-hidden rounded-lg border border-border bg-card p-3">
    <div className="flex items-center gap-2.5">
      <DockerIcon className="size-6" />

      <div className="space-y-0.5">
        <div className="min-w-0 flex-1 truncate text-sm leading-none font-medium tracking-tight text-foreground">
          {data.name}
        </div>
        <div className="text-xs text-muted-foreground">
          {data.config.docker_image}
        </div>
      </div>
    </div>

    <div className="text-xs mt-1 pt-2">Service ready to deploy</div>
  </div>
);
