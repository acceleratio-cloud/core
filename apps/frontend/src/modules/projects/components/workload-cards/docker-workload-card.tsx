'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Container } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';

export type DockerWorkloadNode = Node<
  Workload & Record<string, unknown>,
  'docker'
>;

export const DockerWorkloadCard = ({ data }: NodeProps<DockerWorkloadNode>) => (
  <div className="w-[240px] overflow-hidden rounded-[10px] border border-border bg-white">
    <div className="flex items-center gap-2.5 px-3 pt-3">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 text-muted-foreground"
      >
        <Container strokeWidth={1.75} className="size-3.5" />
      </span>

      <p
        title={data.name}
        className="min-w-0 flex-1 truncate text-[13px] leading-none font-medium tracking-tight text-foreground"
      >
        {data.name}
      </p>
    </div>

    <div className="mt-2.5 border-t border-border px-3 py-2">
      <p
        title={data.config.docker_image}
        className="truncate font-mono text-[11px] leading-none text-muted-foreground"
      >
        {data.config.docker_image}
      </p>
    </div>
  </div>
);
