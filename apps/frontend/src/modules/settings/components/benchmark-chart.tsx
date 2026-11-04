'use client';

import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';

export type ChartPoint = { t: number; value: number };

type BenchmarkChartProps = {
  /** What the y-axis measures, such as "IOPS" or "Latency". */
  title: string;
  points: ChartPoint[];
  format: (value: number) => string;
};

/** Rounds an axis maximum up to 1, 2, 2.5 or 5 times a power of ten. */
const niceMax = (value: number) => {
  if (value <= 0) {
    return 1;
  }

  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const nice =
    fraction <= 1
      ? 1
      : fraction <= 2
        ? 2
        : fraction <= 2.5
          ? 2.5
          : fraction <= 5
            ? 5
            : 10;

  return nice * exponent;
};

const compact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const tickLabel = (value: number, max: number) =>
  max >= 10_000 ? compact.format(value) : String(Math.round(value * 10) / 10);

/**
 * Single-series line over time: 2px line with a 10% wash, hairline grid,
 * crosshair and tooltip on hover or arrow keys. One axis; never dual.
 */
export const BenchmarkChart = ({
  title,
  points,
  format,
}: BenchmarkChartProps) => {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div className="flex h-36 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-[12px] text-muted-foreground">
        {title}: the test finished too quickly to chart. See the numbers above.
      </div>
    );
  }

  const first = points[0].t;
  const span = Math.max(points[points.length - 1].t - first, 1);
  const max = niceMax(Math.max(...points.map((point) => point.value)));
  const x = (t: number) => ((t - first) / span) * 100;
  const y = (value: number) => 100 - (value / max) * 100;
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${x(point.t)},${y(point.value)}`,
    )
    .join(' ');
  const area = `${line} L100,100 L0,100 Z`;
  const peak = Math.max(...points.map((point) => point.value));
  const low = Math.min(...points.map((point) => point.value));
  const selected = active === null ? null : points[active];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const t = first + ((event.clientX - box.left) / box.width) * span;
    let nearest = 0;

    points.forEach((point, index) => {
      if (Math.abs(point.t - t) < Math.abs(points[nearest].t - t)) {
        nearest = index;
      }
    });

    setActive(nearest);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const current = active ?? -1;
    const next =
      event.key === 'ArrowRight'
        ? Math.min(current + 1, last)
        : event.key === 'ArrowLeft'
          ? Math.max(current - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;

    if (next !== null) {
      event.preventDefault();
      setActive(next);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-[12px] font-medium text-fg-secondary">
        {title} over time
      </figcaption>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* y ticks: 0, half and the rounded maximum */}
        <div
          aria-hidden="true"
          className="flex h-32 flex-col justify-between text-right text-[11px] leading-none text-muted-foreground tabular-nums"
        >
          <span>{tickLabel(max, max)}</span>
          <span>{tickLabel(max / 2, max)}</span>
          <span>0</span>
        </div>

        <div
          role="group"
          tabIndex={0}
          aria-label={`${title} over ${Math.round(span)} seconds: from ${format(points[0].value)} to ${format(points[points.length - 1].value)}, peak ${format(peak)}, low ${format(low)}. Use the arrow keys to read each second.`}
          aria-describedby={`${id}-readout`}
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
          className="relative h-32 cursor-crosshair rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {[0, 50, 100].map((level) => (
              <line
                key={level}
                x1="0"
                x2="100"
                y1={level}
                y2={level}
                vectorEffect="non-scaling-stroke"
                className="stroke-edge-subtle"
                strokeWidth={1}
              />
            ))}
            <path d={area} className="fill-brand-fg/10" stroke="none" />
            <path
              d={line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className="stroke-brand-fg"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>

          {/* Positions come from the data, so they are the one place this
              chart uses inline style; colors and sizes stay in tokens. */}
          {selected ? (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-edge-default"
                style={{ left: `${x(selected.t)}%` }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-fg ring-2 ring-surface-raised"
                style={{
                  left: `${x(selected.t)}%`,
                  top: `${y(selected.value)}%`,
                }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-[12px] whitespace-nowrap text-foreground shadow-lg tabular-nums"
                style={
                  x(selected.t) > 60
                    ? { right: `${100 - x(selected.t)}%` }
                    : { left: `${x(selected.t)}%` }
                }
              >
                <span className="text-muted-foreground">{selected.t} s · </span>
                {format(selected.value)}
              </span>
            </>
          ) : null}
        </div>

        <span aria-hidden="true" />
        <div
          aria-hidden="true"
          className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums"
        >
          <span>{first} s</span>
          <span>{points[points.length - 1].t} s</span>
        </div>
      </div>
      <p id={`${id}-readout`} aria-live="polite" className="sr-only">
        {selected ? `${selected.t} seconds: ${format(selected.value)}` : ''}
      </p>
    </figure>
  );
};
