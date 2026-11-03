'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  CircleAlert,
  Clock,
  LoaderCircle,
  Rocket,
  type LucideIcon,
} from 'lucide-react';

import type {
  Workload,
  WorkloadStatus as WorkloadStatusValue,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { canDeployWorkload } from '@/modules/workloads/utils/workload-capabilities';
import { Button } from '@/shared/components/ui/button';

/**
 * Building blocks for service cards on the project canvas: a header with an
 * icon tile and a status meter, label/value rows, an optional notice, and a
 * footer that either offers Deploy or says when the service was deployed.
 */

export const NodeCard = ({
  selected = false,
  children,
}: {
  selected?: boolean;
  children: ReactNode;
}) => (
  <div
    className={cn(
      'w-66 cursor-pointer overflow-hidden rounded-lg border bg-surface-raised shadow-float',
      'outline-1 outline-offset-3 transition-[border-color,outline-color] duration-150 ease-out motion-reduce:transition-none',
      selected
        ? 'border-brand-fg/70 outline-brand-fg/30'
        : 'border-border outline-transparent hover:border-edge-control',
    )}
  >
    {children}
  </div>
);

const METER_BARS = 5;

const meterStyles: Record<
  WorkloadStatusValue,
  { filled: number; tone: string; pulse?: boolean }
> = {
  draft: { filled: 0, tone: '' },
  deploying: { filled: METER_BARS, tone: 'bg-brand-fg', pulse: true },
  running: { filled: METER_BARS, tone: 'bg-status-success' },
  stopped: { filled: 0, tone: '' },
  failed: { filled: 2, tone: 'bg-status-danger' },
};

/** Slanted signal bars. Decorative: the Status row carries the label. */
const StatusMeter = ({ status }: { status: WorkloadStatusValue }) => {
  const { filled, tone, pulse } = meterStyles[status];

  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
      {Array.from({ length: METER_BARS }, (_, index) => (
        <span
          key={index}
          style={pulse ? { animationDelay: `${index * 120}ms` } : undefined}
          className={cn(
            'h-3 w-1 -skew-x-12 rounded-xs',
            index < filled ? tone : 'bg-edge-default',
            pulse && 'animate-pulse motion-reduce:animate-none',
          )}
        />
      ))}
    </span>
  );
};

export const NodeHeader = ({
  icon,
  title,
  status,
}: {
  icon: ReactNode;
  title: string;
  status: WorkloadStatusValue;
}) => (
  <div className="flex items-center gap-2.5 border-b border-edge-subtle bg-surface-muted/40 px-3 py-2.5">
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-sunken">
      {icon}
    </span>
    <span
      title={title}
      className="min-w-0 flex-1 truncate text-sm leading-tight font-semibold tracking-tight text-foreground"
    >
      {title}
    </span>
    <StatusMeter status={status} />
  </div>
);

export const NodeRows = ({ children }: { children: ReactNode }) => (
  <dl className="flex flex-col px-3 py-1.5">{children}</dl>
);

export const NodeRow = ({
  icon: Icon,
  label,
  title,
  children,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  children: ReactNode;
}) => (
  <div className="flex h-7 items-center gap-3">
    <dt className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      {label}
    </dt>
    <dd
      title={title}
      className="ml-auto min-w-0 truncate text-right font-mono text-xs text-foreground tabular-nums"
    >
      {children}
    </dd>
  </div>
);

/**
 * A failure message from the cluster. Red marks only the icon and title; the
 * message itself is neutral text on a dark well, which stays readable at small
 * sizes. Long messages clamp to three lines and expand in place.
 */
export const NodeNotice = ({ children }: { children: string }) => {
  const messageId = useId();
  const messageRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const message = messageRef.current;

    if (!message || expanded) {
      return;
    }

    // The observer fires once on observe, so this also covers the first paint.
    const observer = new ResizeObserver(() =>
      setOverflows(message.scrollHeight > message.clientHeight + 1),
    );
    observer.observe(message);

    return () => observer.disconnect();
  }, [children, expanded]);

  return (
    <div className="mx-3 mb-3 rounded-md border border-destructive/50 bg-red-950/25">
      <div className="flex h-7 items-center gap-1.5 pr-1 pl-2.5">
        <CircleAlert
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 shrink-0 text-status-danger"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-status-danger">
          Error
        </span>
        {overflows || expanded ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
            aria-controls={messageId}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
            className="nodrag nopan shrink-0 text-muted-foreground"
          >
            {expanded ? 'Show less' : 'Show more'}
            <ChevronDown
              data-icon="inline-end"
              aria-hidden="true"
              strokeWidth={1.75}
              className={cn(
                'transition-transform duration-150 motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
            />
          </Button>
        ) : null}
      </div>

      {/* Padding lives on the wrapper: a clamped element clips at its padding
          edge, so padding on it would let the next line peek out. */}
      <div className="px-2.5 pb-2.5">
        <p
          ref={messageRef}
          id={messageId}
          // Selectable so the message can be copied without dragging the node.
          className={cn(
            'nodrag nopan cursor-text text-xs leading-relaxed break-words text-fg-secondary select-text',
            !expanded && 'line-clamp-3',
          )}
        >
          {children}
        </p>
      </div>
    </div>
  );
};

export const WorkloadNodeFooter = ({ workload }: { workload: Workload }) => {
  if (canDeployWorkload(workload.status)) {
    return <NodeDeployButton workload={workload} />;
  }

  const deployedAt = workload.last_deployed_at;

  return (
    <div className="flex h-9 items-center justify-center gap-1.5 border-t border-edge-subtle text-xs text-muted-foreground">
      {workload.status === 'deploying' ? (
        <>
          <LoaderCircle
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          Deploying
        </>
      ) : (
        <>
          <Clock aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          {deployedAt ? (
            <time dateTime={deployedAt} title={formatAbsoluteTime(deployedAt)}>
              Deployed {formatRelativeTime(deployedAt)}
            </time>
          ) : (
            'Not deployed yet'
          )}
        </>
      )}
    </div>
  );
};

const NodeDeployButton = ({ workload }: { workload: Workload }) => {
  const { project, replaceWorkload } = useProject();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deploy = async () => {
    setIsPending(true);
    setError(null);

    try {
      replaceWorkload(await workloadsApi.deploy(project.id, workload.id));
    } catch (deployError) {
      setError(getApiErrorMessage(deployError));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="px-3 pt-0.5 pb-3">
      <Button
        type="button"
        size="sm"
        aria-label={`Deploy ${workload.name}`}
        loading={isPending}
        // The card opens the details panel on click; Deploy should not.
        onClick={(event) => {
          event.stopPropagation();
          void deploy();
        }}
        className="nodrag nopan w-full"
      >
        <Rocket data-icon="inline-start" aria-hidden="true" strokeWidth={1.75} />
        {isPending ? 'Deploying' : 'Deploy'}
      </Button>
      {error ? (
        <p
          role="alert"
          title={error}
          className="mt-1.5 line-clamp-2 text-xs leading-snug text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
};
