'use client';

import { RefreshCw, X } from 'lucide-react';

import type { LogRange } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import type { LogStreamStatus } from '../hooks/use-log-stream';
import { LOG_RANGES, RANGE_LABELS } from '../utils/constants';
import { formatWindow } from '../utils/format';

type LogsToolbarProps = {
  /** Null while a zoomed-in window from the chart is shown. */
  range: LogRange | null;
  customWindow: { start: string; end: string } | null;
  onRangeChange: (range: LogRange) => void;
  live: boolean;
  liveStatus: LogStreamStatus;
  onLiveChange: (live: boolean) => void;
  isLoading: boolean;
  onRefresh: () => void;
};

const SEGMENT =
  'h-7.5 cursor-pointer rounded-md px-2.5 font-mono text-xs tabular-nums outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-foreground/60';

const LIVE_LABELS: Record<LogStreamStatus, string> = {
  off: 'Live',
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
};

/**
 * The floating control bar: follow new lines live, pick a window, or clear a
 * window zoomed in on the chart.
 */
export const LogsToolbar = ({
  range,
  customWindow,
  onRangeChange,
  live,
  liveStatus,
  onLiveChange,
  isLoading,
  onRefresh,
}: LogsToolbarProps) => (
  <div className="flex h-10 items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-float">
    <button
      type="button"
      aria-pressed={live}
      onClick={() => onLiveChange(!live)}
      title={
        live ? 'Stop following new lines' : 'Follow new lines as they arrive'
      }
      className={cn(
        SEGMENT,
        'flex items-center gap-2 font-sans font-medium',
        live
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      <span aria-hidden="true" className="relative flex size-2">
        {live && liveStatus === 'live' ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-status-success opacity-60 motion-reduce:animate-none" />
        ) : null}
        <span
          className={cn(
            'relative size-2 rounded-full',
            !live && 'bg-fg-disabled',
            live && liveStatus === 'live' && 'bg-status-success',
            live && liveStatus !== 'live' && 'bg-status-warning',
          )}
        />
      </span>
      <span aria-live="polite">{live ? LIVE_LABELS[liveStatus] : 'Live'}</span>
    </button>

    <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />

    {customWindow ? (
      <span className="flex h-7.5 items-center gap-1 rounded-md bg-muted pr-1 pl-2.5 font-mono text-xs text-foreground tabular-nums">
        <span
          className="max-w-40 truncate"
          title={`Zoomed in: ${formatWindow(customWindow.start, customWindow.end)}`}
        >
          {formatWindow(customWindow.start, customWindow.end)}
        </span>
        <button
          type="button"
          onClick={() => onRangeChange(range ?? '1h')}
          aria-label="Clear the zoomed window"
          title="Clear the zoomed window"
          className="flex size-5.5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/60"
        >
          <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        </button>
      </span>
    ) : null}

    <div
      role="radiogroup"
      aria-label="Time range"
      className="flex items-center gap-0.5"
    >
      {LOG_RANGES.map((value) => {
        const active = !customWindow && value === range;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={RANGE_LABELS[value]}
            title={RANGE_LABELS[value]}
            onClick={() => onRangeChange(value)}
            className={cn(
              SEGMENT,
              active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {value}
          </button>
        );
      })}
    </div>

    <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />

    <button
      type="button"
      onClick={onRefresh}
      aria-label="Reload logs"
      title="Reload logs"
      className="flex size-7.5 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/60"
    >
      <RefreshCw
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(
          'size-3.5',
          isLoading && 'animate-spin motion-reduce:animate-none',
        )}
      />
    </button>
  </div>
);
