'use client';

import { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';

import type { MetricsPoint } from '@acceleratio/shared';
import { splitValue } from '../utils/format';
import { Panel } from './panel';

type StatPanelProps = {
  title: string;
  /** The formatted headline, such as `320m` or `1.2 GiB`; null shows a dash. */
  value: string | null;
  /** One line of context under the figure (`of 2 cores limit`). */
  caption?: string;
  /** History behind the figure, drawn as a quiet sparkline. */
  points?: MetricsPoint[];
};

/** A single headline figure with its trend underneath. */
export const StatPanel = ({
  title,
  value,
  caption,
  points,
}: StatPanelProps) => {
  const gradientId = useId().replace(/:/g, '');
  const { number, unit } = splitValue(value ?? '—');
  const rows = points?.map(([t, v]) => ({ t, v })) ?? [];

  return (
    <Panel title={title} wellClassName="h-28">
      <div className="relative z-10 flex flex-col gap-1 px-3.5 pt-3">
        <p className="flex items-baseline gap-1.5 font-mono tracking-tight text-fg-primary tabular-nums">
          <span className="text-2xl leading-none font-medium">{number}</span>
          {unit ? (
            <span className="text-sm leading-none text-fg-secondary">
              {unit}
            </span>
          ) : null}
        </p>
        {caption ? (
          <p className="truncate text-[11px] text-fg-tertiary" title={caption}>
            {caption}
          </p>
        ) : null}
      </div>

      {rows.length > 1 ? (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-12">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={rows}
              margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--fg-secondary)"
                    stopOpacity={0.16}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--fg-secondary)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <YAxis hide domain={[0, 'auto']} />
              <Area
                dataKey="v"
                type="monotone"
                stroke="var(--fg-secondary)"
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </Panel>
  );
};
