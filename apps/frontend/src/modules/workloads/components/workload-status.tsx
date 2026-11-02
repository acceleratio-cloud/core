import type { WorkloadStatus as WorkloadStatusValue } from '@acceleratio/shared';

import { cn } from '@/lib/utils';

const statusStyles: Record<
  WorkloadStatusValue,
  { label: string; dot: string; text: string }
> = {
  draft: {
    label: 'Draft',
    dot: 'border border-muted-foreground bg-transparent',
    text: 'text-muted-foreground',
  },
  deploying: {
    label: 'Deploying',
    dot: 'animate-pulse bg-muted-foreground motion-reduce:animate-none',
    text: 'text-muted-foreground',
  },
  running: {
    label: 'Running',
    dot: 'bg-foreground',
    text: 'text-foreground',
  },
  stopped: {
    label: 'Stopped',
    dot: 'bg-muted-foreground/40',
    text: 'text-muted-foreground',
  },
  failed: {
    label: 'Failed',
    dot: 'bg-destructive',
    text: 'text-destructive',
  },
};

type WorkloadStatusProps = {
  status: WorkloadStatusValue;
  statusMessage?: string | null;
  compact?: boolean;
  className?: string;
};

/**
 * Presentational status for a workload. Everything is achromatic except
 * `failed`, which is the only state that may take Signal Red.
 */
export const WorkloadStatus = ({
  status,
  statusMessage,
  compact = false,
  className,
}: WorkloadStatusProps) => {
  const style = statusStyles[status];

  return (
    <span className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn('size-1.5 shrink-0 rounded-full', style.dot)}
        />
        <span
          className={cn(
            'truncate leading-none font-medium',
            compact ? 'text-[11px]' : 'text-xs',
            style.text,
          )}
        >
          {style.label}
        </span>
      </span>

      {status === 'failed' && statusMessage ? (
        <span
          title={statusMessage}
          className={cn(
            'text-destructive',
            compact
              ? 'line-clamp-1 text-[10px] leading-snug'
              : 'line-clamp-2 text-[11px] leading-snug',
          )}
        >
          {statusMessage}
        </span>
      ) : null}
    </span>
  );
};
