import type { ReactNode } from 'react';
import { Boxes, RotateCcw, Server, SquareTerminal } from 'lucide-react';

import type {
  WorkloadInstance,
  WorkloadInstanceStatus,
} from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { shortInstanceName } from '@/modules/workloads/utils/instance-name';
import { formatAbsoluteTime } from '@/modules/workloads/utils/format-time';
import {
  formatAge,
  formatDecimalBytes,
  formatVcpu,
} from '@/modules/workloads/utils/format-usage';
import { CopyButton } from '@/shared/components/copy-button';
import { Button } from '@/shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { DetailSection } from './detail-primitives';

const statusStyles: Record<
  WorkloadInstanceStatus,
  { label: string; dot: string; text: string }
> = {
  running: {
    label: 'Running',
    dot: 'bg-status-success',
    text: 'text-fg-secondary',
  },
  starting: {
    label: 'Starting',
    dot: 'animate-pulse bg-fg-tertiary motion-reduce:animate-none',
    text: 'text-fg-secondary',
  },
  pending: {
    label: 'Pending',
    dot: 'bg-status-warning',
    text: 'text-status-warning',
  },
  terminating: {
    label: 'Stopping',
    dot: 'animate-pulse bg-fg-tertiary/50 motion-reduce:animate-none',
    text: 'text-fg-tertiary',
  },
  failed: {
    label: 'Failed',
    dot: 'bg-status-danger',
    text: 'text-status-danger',
  },
  completed: {
    label: 'Exited',
    dot: 'bg-fg-tertiary/50',
    text: 'text-fg-tertiary',
  },
  unknown: {
    label: 'Unknown',
    dot: 'border border-fg-tertiary bg-transparent',
    text: 'text-fg-tertiary',
  },
};

const summaryOf = (instances: WorkloadInstance[]) => {
  const active = instances.filter(
    (instance) =>
      instance.status !== 'terminating' && instance.status !== 'completed',
  );
  const ready = active.filter((instance) => instance.ready).length;
  const noun = active.length === 1 ? 'instance' : 'instances';

  return { label: `${active.length} ${noun}`, ready };
};

const barTone = (ratio: number) =>
  ratio >= 0.95
    ? 'bg-status-danger'
    : ratio >= 0.8
      ? 'bg-status-warning'
      : 'bg-fg-primary';

/**
 * Usage as a bar of the limit. The numbers live in the tooltip: current
 * usage, the limit and the share. Without a limit the track stays empty and
 * the tooltip says so; a sample that has not arrived yet reads as unknown.
 */
const UsageBar = ({
  value,
  limit,
  format,
  label,
  metricsAvailable,
}: {
  value: number | null;
  limit: number | null;
  format: (value: number) => string;
  label: string;
  metricsAvailable: boolean;
}) => {
  const ratio =
    value !== null && limit !== null && limit > 0 ? value / limit : null;
  const percent = ratio === null ? null : Math.round(Math.min(ratio, 1) * 100);
  const current =
    value !== null
      ? format(value)
      : metricsAvailable
        ? 'Waiting for the first sample'
        : 'Unavailable';
  const max = limit !== null ? format(limit) : 'No limit';
  const summary =
    percent !== null
      ? `${label}: ${current} of ${max} (${percent}%)`
      : `${label}: ${current}, ${max.toLowerCase()}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        delay={0}
        closeDelay={0}
        tabIndex={0}
        role="meter"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? 0}
        aria-valuetext={summary}
        className="block cursor-default rounded-full py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            'block h-2 w-full overflow-hidden rounded-full bg-edge-default',
            limit === null &&
              'bg-[repeating-linear-gradient(135deg,var(--color-edge-default)_0_4px,var(--color-surface-sunken)_4px_8px)]',
          )}
        >
          <span
            className={cn(
              'block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
              ratio === null ? 'bg-transparent' : barTone(ratio),
            )}
            // A sliver keeps tiny but non-zero usage visible.
            style={{
              width:
                ratio === null || ratio <= 0
                  ? '0%'
                  : `max(3px, ${Math.min(ratio, 1) * 100}%)`,
            }}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
          <dt className="text-muted-foreground">Current</dt>
          <dd className="text-right font-mono">{current}</dd>
          <dt className="text-muted-foreground">Max</dt>
          <dd className="text-right font-mono">{max}</dd>
          {percent !== null ? (
            <>
              <dt className="text-muted-foreground">Used</dt>
              <dd className="text-right font-mono">{percent}%</dd>
            </>
          ) : null}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
};

const LiveIndicator = ({ isLive }: { isLive: boolean }) => (
  <span
    className="flex items-center gap-1.5 text-[11px] text-fg-tertiary"
    title={isLive ? 'Updates arrive as they happen' : 'Live updates are paused'}
  >
    <span aria-hidden="true" className="relative flex size-1.5">
      {isLive ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-status-success/60 motion-reduce:hidden" />
      ) : null}
      <span
        className={cn(
          'relative size-1.5 rounded-full',
          isLive ? 'bg-status-success' : 'bg-fg-tertiary/50',
        )}
      />
    </span>
    {isLive ? 'Live' : 'Paused'}
  </span>
);

/** Why the terminal button of an instance is disabled, if it is. */
const terminalBlocker = (
  instance: WorkloadInstance,
  canOpenTerminal: boolean,
): string | null => {
  if (instance.status !== 'running') {
    return 'A terminal opens only on a running instance';
  }

  return canOpenTerminal
    ? null
    : 'Close a terminal tab to open another (up to 7)';
};

const TerminalButton = ({
  instance,
  canOpenTerminal,
  onOpenTerminal,
}: {
  instance: WorkloadInstance;
  canOpenTerminal: boolean;
  onOpenTerminal: (instance: WorkloadInstance) => void;
}) => {
  const blocker = terminalBlocker(instance, canOpenTerminal);

  return (
    <Tooltip>
      <TooltipTrigger
        // A disabled button gets no hover, so the wrapper carries the tooltip.
        render={<span className="inline-flex" />}
        delay={0}
        closeDelay={0}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Open terminal on ${shortInstanceName(instance.name)}`}
          disabled={blocker !== null}
          onClick={() => onOpenTerminal(instance)}
          className="text-fg-secondary hover:text-fg-primary"
        >
          <SquareTerminal aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{blocker ?? 'Open terminal'}</TooltipContent>
    </Tooltip>
  );
};

const InstanceRow = ({
  instance,
  activeVersionId,
  metricsAvailable,
  canOpenTerminal,
  onOpenTerminal,
  logsLink,
}: {
  instance: WorkloadInstance;
  activeVersionId: string | null;
  metricsAvailable: boolean;
  canOpenTerminal: boolean;
  onOpenTerminal?: (instance: WorkloadInstance) => void;
  logsLink?: (instance: WorkloadInstance) => ReactNode;
}) => {
  const hasActions = Boolean(onOpenTerminal ?? logsLink);
  const style = statusStyles[instance.status];
  const since = instance.started_at ?? instance.created_at;
  const isPrevious =
    activeVersionId !== null &&
    instance.version_id !== null &&
    instance.version_id !== activeVersionId;
  const detail = [instance.status_reason, instance.status_message]
    .filter(Boolean)
    .join(': ');
  const showDetail =
    detail !== '' &&
    (instance.status === 'failed' || instance.status === 'pending');

  return (
    <tr
      className={cn(
        'group border-b border-edge-subtle align-middle transition-colors last:border-b-0 hover:bg-surface-panel',
        instance.status === 'terminating' && 'opacity-60',
      )}
    >
      <th scope="row" className="py-3 pr-3 pl-4 text-left font-normal">
        <span className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={cn('mt-1.5 size-2 shrink-0 rounded-full', style.dot)}
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="font-mono text-[13px] leading-5 font-medium text-fg-primary"
                title={instance.name}
              >
                {shortInstanceName(instance.name)}
              </span>
              <CopyButton
                value={instance.name}
                label="instance name"
                className="size-5 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              />
              {isPrevious ? (
                <span className="rounded-sm border border-edge-default px-1.5 text-[10px] leading-4 text-fg-tertiary">
                  Previous version
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
              <span className={cn('font-medium', style.text)}>
                {style.label}
              </span>
              {instance.node ? (
                <>
                  <span aria-hidden="true" className="text-fg-disabled">
                    ·
                  </span>
                  <span
                    className="flex min-w-0 items-center gap-1 text-fg-tertiary"
                    title={
                      instance.ip
                        ? `Node ${instance.node} · ${instance.ip}`
                        : `Node ${instance.node}`
                    }
                  >
                    <Server
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-3 shrink-0"
                    />
                    <span className="truncate">{instance.node}</span>
                  </span>
                </>
              ) : null}
            </span>
            {showDetail ? (
              <span
                className={cn(
                  'text-[11px] leading-snug break-words',
                  instance.status === 'failed'
                    ? 'text-status-danger'
                    : 'text-status-warning',
                )}
              >
                {detail}
              </span>
            ) : null}
          </span>
        </span>
      </th>
      <td className="px-3 py-3">
        <UsageBar
          value={instance.cpu_cores}
          limit={instance.cpu_limit_cores}
          format={formatVcpu}
          label="CPU"
          metricsAvailable={metricsAvailable}
        />
      </td>
      <td className="px-3 py-3">
        <UsageBar
          value={instance.memory_bytes}
          limit={instance.memory_limit_bytes}
          format={formatDecimalBytes}
          label="Memory"
          metricsAvailable={metricsAvailable}
        />
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
        {instance.restarts > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-status-warning">
            <RotateCcw aria-hidden="true" strokeWidth={2} className="size-3" />
            {instance.restarts}
          </span>
        ) : (
          <span className="text-fg-tertiary">0</span>
        )}
      </td>
      <td
        className={cn(
          'py-3 pl-3 text-right font-mono text-xs whitespace-nowrap text-fg-secondary tabular-nums',
          hasActions ? 'pr-3' : 'pr-4',
        )}
      >
        {since ? (
          <time dateTime={since} title={formatAbsoluteTime(since)}>
            {formatAge(since)}
          </time>
        ) : (
          <span className="text-fg-tertiary">—</span>
        )}
      </td>
      {hasActions ? (
        <td className="py-2 pr-3 pl-1 text-right">
          <span className="inline-flex items-center gap-0.5">
            {logsLink?.(instance)}
            {onOpenTerminal ? (
              <TerminalButton
                instance={instance}
                canOpenTerminal={canOpenTerminal}
                onOpenTerminal={onOpenTerminal}
              />
            ) : null}
          </span>
        </td>
      ) : null}
    </tr>
  );
};

export type WorkloadInstancesListProps = {
  instances: WorkloadInstance[] | null;
  metricsAvailable: boolean;
  isLive: boolean;
  /** The version the service runs now; older instances are being replaced. */
  activeVersionId: string | null;
  /** Shown when there are no instances, e.g. "The service is stopped." */
  emptyHint: string;
  /** Adds a terminal button to each row when set. */
  onOpenTerminal?: (instance: WorkloadInstance) => void;
  /** False when the terminal dock has no free tab. */
  canOpenTerminal?: boolean;
  /** Adds a link to each instance's logs when set. */
  logsLink?: (instance: WorkloadInstance) => ReactNode;
};

const headerCell = 'px-3 py-2 text-right text-[11px] font-medium';

/**
 * The running copies of a service with their status, current CPU and memory,
 * restarts and age.
 */
export const WorkloadInstancesList = ({
  instances,
  metricsAvailable,
  isLive,
  activeVersionId,
  emptyHint,
  onOpenTerminal,
  canOpenTerminal = true,
  logsLink,
}: WorkloadInstancesListProps) => {
  const summary = instances ? summaryOf(instances) : null;
  const hasActions = Boolean(onOpenTerminal ?? logsLink);

  return (
    <DetailSection title="Instances">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-edge-subtle px-4 text-xs">
        <span
          className="flex items-center gap-2 tabular-nums"
          aria-live="polite"
        >
          {summary ? (
            <>
              <span className="font-medium text-fg-primary">
                {summary.label}
              </span>
              <span className="rounded-sm bg-surface-sunken px-1.5 text-[11px] leading-5 text-fg-secondary">
                {summary.ready} ready
              </span>
            </>
          ) : (
            <span className="text-fg-tertiary">Loading instances…</span>
          )}
        </span>
        <LiveIndicator isLive={isLive} />
      </div>

      {instances === null ? (
        <div className="flex flex-col gap-2 p-4" aria-hidden="true">
          <div className="h-10 animate-[delayed-in_150ms_200ms_both] rounded-md bg-surface-sunken motion-reduce:animate-none" />
        </div>
      ) : instances.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
          <p className="text-xs font-medium text-fg-secondary">
            No instances running
          </p>
          <p className="text-xs text-fg-tertiary">{emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <TooltipProvider delay={0} closeDelay={0}>
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-edge-subtle bg-surface-panel/60 text-fg-tertiary">
                  <th scope="col" className={cn(headerCell, 'pl-4 text-left')}>
                    Instance
                  </th>
                  <th scope="col" className={cn(headerCell, 'w-36 text-left')}>
                    CPU
                  </th>
                  <th scope="col" className={cn(headerCell, 'w-36 text-left')}>
                    Memory
                  </th>
                  <th scope="col" className={cn(headerCell, 'w-20')}>
                    Restarts
                  </th>
                  <th
                    scope="col"
                    className={cn(
                      headerCell,
                      'w-16',
                      hasActions ? 'pr-3' : 'pr-4',
                    )}
                  >
                    Age
                  </th>
                  {hasActions ? (
                    <th
                      scope="col"
                      className={cn(
                        headerCell,
                        logsLink && onOpenTerminal ? 'w-20 pr-3' : 'w-12 pr-3',
                      )}
                    >
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {instances.map((instance) => (
                  <InstanceRow
                    key={instance.name}
                    instance={instance}
                    activeVersionId={activeVersionId}
                    metricsAvailable={metricsAvailable}
                    canOpenTerminal={canOpenTerminal}
                    onOpenTerminal={onOpenTerminal}
                    logsLink={logsLink}
                  />
                ))}
              </tbody>
            </table>
          </TooltipProvider>
        </div>
      )}
    </DetailSection>
  );
};
