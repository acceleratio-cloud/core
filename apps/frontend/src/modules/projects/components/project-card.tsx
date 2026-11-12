'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, PanelsTopLeft, Plus } from 'lucide-react';

import type { Project, Workload } from '@acceleratio/shared';
import { workloadsApi } from '@/api/workloads';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { bucketStatusLabel } from '@/modules/workloads/utils/s3-bucket';
import { WorkloadIcon } from '@/modules/workloads/components/workload-icon';
import { BucketIcon } from '@/shared/icons/bucket-icon';
import { DockerIcon } from '@/shared/icons/docker-icon';
import { GithubIcon } from '@/shared/icons/github-icon';
import { PostgresIcon } from '@/shared/icons/postgres-icon';

/** Tiles in the preview grid. Past this, the last tile counts the rest. */
const PREVIEW_SLOTS = 6;
const MAX_VISIBLE_WORKLOADS = 5;

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const formatDate = (value: string) => dateFormatter.format(new Date(value));

const pluralizeServices = (count: number) =>
  `${count} ${count === 1 ? 'service' : 'services'}`;

type WorkloadsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; workloads: Workload[] };

const useProjectWorkloads = (projectId: string) => {
  const [state, setState] = useState<WorkloadsState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    workloadsApi
      .list(projectId)
      .then((workloads) => {
        if (active) {
          setState({ status: 'ready', workloads });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: 'error' });
        }
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  return state;
};

/** The board the tiles sit on: the project canvas, in miniature. */
const PreviewBoard = ({ children }: { children: ReactNode }) => (
  <div
    aria-hidden="true"
    className="relative h-36 overflow-hidden rounded-lg border border-edge-subtle bg-surface-board p-2"
  >
    {children}
  </div>
);

const PreviewGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid h-full grid-cols-3 grid-rows-2 gap-1.5">{children}</div>
);

const WorkloadTile = ({ workload }: { workload: Workload }) => (
  <div className="flex min-w-0 flex-col justify-between rounded-md border border-border bg-surface-raised px-2 py-1.5 shadow-xs transition-colors group-hover:border-edge-strong">
    <div className="flex min-w-0 items-center gap-1.5">
      <WorkloadIcon
        icon={workload.icon}
        className="size-3.5 shrink-0"
        fallback={
          workload.type === 's3_bucket' ? (
            <BucketIcon className="size-3.5 shrink-0" />
          ) : workload.type === 'github' ? (
            <GithubIcon className="size-3.5 shrink-0" />
          ) : workload.type === 'postgres' ? (
            <PostgresIcon className="size-3.5 shrink-0" />
          ) : workload.type === 'static' ? (
            <PanelsTopLeft
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 shrink-0"
            />
          ) : (
            <DockerIcon className="size-3.5 shrink-0" />
          )
        }
      />
      <span className="min-w-0 truncate text-xs leading-tight font-medium text-foreground">
        {workload.name}
      </span>
    </div>
    <WorkloadStatus
      status={workload.status}
      label={
        workload.type === 's3_bucket'
          ? bucketStatusLabel(workload.status)
          : undefined
      }
      compact
    />
  </div>
);

const OverflowTile = ({ count }: { count: number }) => (
  <div className="flex min-w-0 items-center justify-center rounded-md border border-dashed border-edge-control bg-surface-raised/60 px-2 text-center">
    <span className="truncate text-xs font-medium text-fg-secondary tabular-nums">
      +{pluralizeServices(count)}
    </span>
  </div>
);

const EmptySlot = () => (
  <div className="rounded-md border border-dashed border-edge-subtle" />
);

const WorkloadsPreview = ({ state }: { state: WorkloadsState }) => {
  if (state.status === 'loading') {
    return (
      <PreviewBoard>
        <PreviewGrid>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="rounded-md" />
          ))}
        </PreviewGrid>
      </PreviewBoard>
    );
  }

  if (state.status === 'error') {
    return (
      <PreviewBoard>
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Services unavailable
        </div>
      </PreviewBoard>
    );
  }

  const { workloads } = state;

  if (workloads.length === 0) {
    return (
      <PreviewBoard>
        <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="flex size-7 items-center justify-center rounded-md border border-dashed border-edge-control bg-surface-raised">
            <Plus aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          </span>
          No services yet
        </div>
      </PreviewBoard>
    );
  }

  const overflow = workloads.length - MAX_VISIBLE_WORKLOADS;
  const visible = workloads.slice(0, MAX_VISIBLE_WORKLOADS);
  const filled = visible.length + (overflow > 0 ? 1 : 0);

  return (
    <PreviewBoard>
      <PreviewGrid>
        {visible.map((workload) => (
          <WorkloadTile key={workload.id} workload={workload} />
        ))}
        {overflow > 0 ? <OverflowTile count={overflow} /> : null}
        {Array.from({ length: PREVIEW_SLOTS - filled }, (_, index) => (
          <EmptySlot key={index} />
        ))}
      </PreviewGrid>
    </PreviewBoard>
  );
};

export const ProjectCard = ({ project }: { project: Project }) => {
  const workloads = useProjectWorkloads(project.id);

  return (
    <Link
      href={`/project/${project.id}`}
      className="group panel-lit flex flex-col gap-2.5 rounded-xl p-2 outline-none transition-colors hover:border-edge-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <WorkloadsPreview state={workloads} />

      <div className="flex items-start gap-3 px-1.5 pb-1">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm leading-tight font-medium text-foreground">
            {project.name}
          </h2>
          <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0 font-mono">{project.id.slice(0, 8)}</span>
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
            {workloads.status === 'ready' ? (
              <span className="shrink-0 tabular-nums">
                {pluralizeServices(workloads.workloads.length)}
              </span>
            ) : null}
            <span className="ml-auto truncate">
              Updated {formatDate(project.updated_at)}
            </span>
          </p>
        </div>

        <ArrowUpRight
          aria-hidden="true"
          strokeWidth={1.75}
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground"
        />
      </div>
    </Link>
  );
};

export const ProjectCardSkeleton = () => {
  return (
    <div className="panel-lit flex flex-col gap-2.5 rounded-xl p-2">
      <Skeleton className="h-36 rounded-lg" />
      <div className="flex flex-col gap-1.5 px-1.5 pb-1">
        <Skeleton className="h-4 w-2/5" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="ml-auto h-3 w-28" />
        </div>
      </div>
    </div>
  );
};
