'use client';

import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { MetricsRange } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { axisTimeFormatter, type ValueFormatter } from '../utils/format';
import {
  seriesStats,
  toChartRows,
  toneColor,
  TONE_BG,
  type ChartSeries,
} from '../utils/series';
import { ChartTooltip } from './chart-tooltip';
import { Panel } from './panel';

/** Every time-series panel shares one crosshair. */
export const METRICS_SYNC_ID = 'project-metrics';

const AXIS_TICK = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  fill: 'var(--fg-tertiary)',
};

type TimeseriesPanelProps = {
  title: string;
  hint?: string;
  series: ChartSeries[];
  range: MetricsRange;
  start: number;
  end: number;
  format: ValueFormatter;
  /** Stacks the series so the top edge is the project total. */
  stacked?: boolean;
  className?: string;
};

/**
 * An area chart over the selected range with a Grafana-style legend: one row
 * per series with its mean, max and last value.
 */
export const TimeseriesPanel = ({
  title,
  hint,
  series,
  range,
  start,
  end,
  format,
  stacked = true,
  className,
}: TimeseriesPanelProps) => {
  const gradientId = useId().replace(/:/g, '');
  const rows = useMemo(() => toChartRows(series), [series]);
  const tickTime = useMemo(() => axisTimeFormatter(range), [range]);
  const hasData = rows.length > 0;
  // Every sample is zero (no reads, no traffic): a flat line on an invented
  // scale says less than saying so.
  const isIdle =
    hasData && series.every((item) => item.points.every(([, v]) => v === 0));

  return (
    <Panel
      title={title}
      hint={hint}
      className={className}
      wellClassName="h-56"
      footer={<SeriesLegend series={series} format={format} />}
    >
      {isIdle ? (
        <EmptyWell label="No activity in this range" />
      ) : hasData ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={rows}
            syncId={METRICS_SYNC_ID}
            margin={{ top: 16, right: 28, bottom: 4, left: 4 }}
          >
            <defs>
              {series.map((item) => (
                <linearGradient
                  key={item.key}
                  id={`${gradientId}-${item.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={toneColor(item.tone)}
                    stopOpacity={stacked ? 0.28 : 0.22}
                  />
                  <stop
                    offset="100%"
                    stopColor={toneColor(item.tone)}
                    stopOpacity={0.04}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[start, end]}
              scale="time"
              tickFormatter={tickTime}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: 'var(--edge-default)' }}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={format}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={84}
              tickCount={5}
              // An all-zero series still gets a readable 0–1 scale.
              domain={[0, (max: number) => (max > 0 ? max * 1.15 : 1)]}
              allowDecimals
            />
            <Tooltip
              cursor={{ stroke: 'var(--fg-tertiary)', strokeDasharray: '3 3' }}
              isAnimationActive={false}
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  label={props.label}
                  payload={props.payload}
                  series={series}
                  format={format}
                  showTotal={stacked}
                />
              )}
            />
            {series.map((item) => (
              <Area
                key={item.key}
                dataKey={item.key}
                name={item.label}
                type="monotone"
                stackId={stacked ? 'stack' : undefined}
                stroke={toneColor(item.tone)}
                strokeWidth={2}
                fill={`url(#${gradientId}-${item.key})`}
                dot={false}
                activeDot={{
                  r: 4,
                  strokeWidth: 2,
                  stroke: 'var(--surface-raised)',
                  fill: toneColor(item.tone),
                }}
                animationDuration={500}
                animationEasing="ease-out"
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <EmptyWell />
      )}
    </Panel>
  );
};

export const EmptyWell = ({ label = 'No samples in this range' }) => (
  <div className="flex h-full items-center justify-center px-4 text-center font-mono text-xs text-fg-tertiary">
    {label}
  </div>
);

const SeriesLegend = ({
  series,
  format,
}: {
  series: ChartSeries[];
  format: ValueFormatter;
}) => {
  if (series.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs">
      {series.map((item) => {
        const stats = seriesStats(item.points);

        return (
          <li key={item.key} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'h-0.5 w-3 shrink-0 rounded-full',
                TONE_BG[item.tone],
              )}
            />
            <span
              className="max-w-40 truncate font-medium text-fg-primary"
              title={item.label}
            >
              {item.label}
            </span>
            {stats ? (
              <span className="font-mono text-[11px] whitespace-nowrap text-fg-tertiary tabular-nums">
                mean {format(stats.mean)} · max {format(stats.max)} · last{' '}
                {format(stats.last)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
