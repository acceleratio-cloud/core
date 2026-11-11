'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type {
  LogHistogramBucket,
  LogLevelFilter,
  ProjectLogHistogram,
} from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { formatCount, formatExactCount } from '../utils/format';
import { LEVEL_STYLES } from '../utils/level';

/** Stack order, bottom up: the severe levels sit on the baseline. */
const STACK: LogLevelFilter[] = ['error', 'warn', 'info', 'debug', 'unknown'];

const AXIS_TICK = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  fill: 'var(--fg-tertiary)',
};

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});
const secondsFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const tooltipFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

type LogsHistogramProps = {
  histogram: ProjectLogHistogram | null;
  /** Narrows the window to `[start, end)`, unix seconds. */
  onZoom: (start: number, end: number) => void;
};

type DragState = { from: number; to: number } | null;

const labelOf = (state: unknown): number | null => {
  const label = (state as { activeLabel?: unknown } | null)?.activeLabel;
  const value = typeof label === 'string' ? Number(label) : label;

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * Lines per level over the window. Drag across bars (or click one) to zoom
 * the whole view into that span.
 */
export const LogsHistogram = ({ histogram, onZoom }: LogsHistogramProps) => {
  const [drag, setDrag] = useState<DragState>(null);
  // Mouse up can arrive before the render that stored the mouse down, so
  // the handlers read the drag from a ref; the state only draws it.
  const dragRef = useRef<DragState>(null);
  const updateDrag = (next: DragState) => {
    dragRef.current = next;
    setDrag(next);
  };
  const step = histogram?.step_seconds ?? 60;
  const span = histogram ? histogram.end - histogram.start : 0;
  const tickFormat = useMemo(() => {
    const format =
      span > 36 * 60 * 60
        ? dayFormat
        : span <= 30 * 60
          ? secondsFormat
          : clockFormat;

    return (seconds: number) => format.format(seconds * 1000);
  }, [span]);

  const finishDrag = () => {
    const current = dragRef.current;

    if (current) {
      const start = Math.min(current.from, current.to);
      const end = Math.max(current.from, current.to) + step;

      onZoom(start, end);
    }

    updateDrag(null);
  };

  if (!histogram) {
    return (
      <div
        aria-hidden="true"
        className="h-24 animate-[delayed-in_150ms_200ms_both] rounded-md bg-surface-sunken motion-reduce:animate-none"
      />
    );
  }

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="sr-only">
        {`${formatExactCount(histogram.total)} lines in the window, by level. Drag across the chart to zoom in.`}
      </figcaption>
      <div className="h-24 select-none" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={histogram.buckets}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barCategoryGap={1}
            // The chart is a pointer shortcut; its numbers are in the
            // caption and the sidebar, so it must not take keyboard focus.
            accessibilityLayer={false}
            onMouseDown={(state) => {
              const label = labelOf(state);

              if (label !== null) {
                updateDrag({ from: label, to: label });
              }
            }}
            onMouseMove={(state) => {
              const label = labelOf(state);

              const current = dragRef.current;

              if (current && label !== null && label !== current.to) {
                updateDrag({ ...current, to: label });
              }
            }}
            onMouseUp={finishDrag}
            onMouseLeave={() => updateDrag(null)}
            className="cursor-crosshair"
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--chart-grid)"
              strokeDasharray="0"
            />
            <XAxis
              dataKey="time"
              tickFormatter={tickFormat}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
              height={18}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => formatCount(value)}
              width={36}
              allowDecimals={false}
              tickCount={3}
            />
            <Tooltip
              cursor={{ fill: 'var(--brand-wash)' }}
              isAnimationActive={false}
              content={({ active, payload }) => (
                <HistogramTooltip
                  active={active}
                  bucket={
                    (payload?.[0]?.payload as LogHistogramBucket | undefined) ??
                    null
                  }
                  step={step}
                />
              )}
            />
            {STACK.map((level, index) => (
              <Bar
                key={level}
                dataKey={level}
                stackId="levels"
                fill={LEVEL_STYLES[level].color}
                isAnimationActive={false}
                radius={index === STACK.length - 1 ? [1.5, 1.5, 0, 0] : 0}
              />
            ))}
            {drag ? (
              <ReferenceArea
                x1={Math.min(drag.from, drag.to)}
                x2={Math.max(drag.from, drag.to)}
                fill="var(--brand-fg)"
                fillOpacity={0.12}
                stroke="var(--brand-fg)"
                strokeOpacity={0.4}
              />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
};

const HistogramTooltip = ({
  active,
  bucket,
  step,
}: {
  active?: boolean;
  bucket: LogHistogramBucket | null;
  step: number;
}) => {
  if (!active || !bucket) {
    return null;
  }

  const total = STACK.reduce((sum, level) => sum + bucket[level], 0);

  return (
    <div className="min-w-44 rounded-lg border border-edge-default bg-surface-raised px-3 py-2 text-xs shadow-float">
      <p className="mb-1.5 font-mono text-[11px] text-fg-tertiary tabular-nums">
        {tooltipFormat.format(bucket.time * 1000)}
        <span className="text-fg-disabled"> · {step}s</span>
      </p>
      <ul className="flex flex-col gap-1">
        {STACK.filter((level) => bucket[level] > 0).map((level) => (
          <li key={level} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'h-2.5 w-0.75 shrink-0 rounded-full',
                LEVEL_STYLES[level].bg,
              )}
            />
            <span className="text-fg-secondary">
              {LEVEL_STYLES[level].label}
            </span>
            <span className="ml-auto pl-3 font-mono text-fg-primary tabular-nums">
              {formatExactCount(bucket[level])}
            </span>
          </li>
        ))}
        <li className="mt-0.5 flex items-center gap-2 border-t border-edge-subtle pt-1">
          <span className="text-fg-secondary">Total</span>
          <span className="ml-auto pl-3 font-mono text-fg-primary tabular-nums">
            {formatExactCount(total)}
          </span>
        </li>
      </ul>
    </div>
  );
};
