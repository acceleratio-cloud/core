'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import type { MetricsRange } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { formatAgo } from '../utils/format';
import { METRICS_RANGES } from '../utils/series';

const RANGE_LABELS: Record<MetricsRange, string> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
};

type RangePickerProps = {
  range: MetricsRange;
  onRangeChange: (range: MetricsRange) => void;
  isLoading: boolean;
  updatedAt: number | null;
  onRefresh: () => void;
};

/** Time range segments, the freshness of the data and a manual refresh. */
export const RangePicker = ({
  range,
  onRangeChange,
  isLoading,
  updatedAt,
  onRefresh,
}: RangePickerProps) => {
  // Re-renders the "updated" label; purely visual state.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-10 items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-float">
      <p
        aria-live="polite"
        className="hidden px-2 font-mono text-[11px] whitespace-nowrap text-fg-tertiary tabular-nums md:block"
      >
        {updatedAt === null
          ? 'Loading…'
          : `Updated ${formatAgo(Math.max(0, now - updatedAt))}`}
      </p>

      <div
        role="radiogroup"
        aria-label="Time range"
        className="flex items-center gap-0.5"
      >
        {METRICS_RANGES.map((value) => {
          const active = value === range;

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
                'h-7.5 cursor-pointer rounded-md px-2.5 font-mono text-xs tabular-nums outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-foreground/60',
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
        aria-label="Refresh metrics"
        title="Refresh metrics"
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
};
