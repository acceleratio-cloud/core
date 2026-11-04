'use client';

import { Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { cn } from '@/lib/utils';
import { formatPercent, type ValueFormatter } from '../utils/format';
import { TONE_BG, toneColor, type ChartTone } from '../utils/series';
import { EmptyWell } from './timeseries-panel';
import { Panel } from './panel';

export type DonutSlice = {
  key: string;
  label: string;
  tone: ChartTone;
  value: number;
};

type DonutPanelProps = {
  title: string;
  hint?: string;
  slices: DonutSlice[];
  format: ValueFormatter;
  className?: string;
};

/** Share of one resource by service, with the figures listed beside it. */
export const DonutPanel = ({
  title,
  hint,
  slices,
  format,
  className,
}: DonutPanelProps) => {
  // Recharts reads each sector's `fill` from its data item.
  const visible = slices
    .filter((slice) => slice.value > 0)
    .map((slice) => ({ ...slice, fill: toneColor(slice.tone) }));
  const total = visible.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <Panel
      title={title}
      hint={hint}
      className={className}
      wellClassName="min-h-56"
    >
      {total > 0 ? (
        <div className="flex h-full flex-col items-center gap-4 p-4 sm:flex-row">
          <div className="size-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={visible}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="60%"
                  outerRadius="94%"
                  startAngle={90}
                  endAngle={-270}
                  stroke="var(--surface-sunken)"
                  strokeWidth={2}
                  animationDuration={500}
                />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    const slice = payload?.[0]?.payload as
                      DonutSlice | undefined;

                    if (!active || !slice) {
                      return null;
                    }

                    return (
                      <div className="rounded-lg border border-edge-default bg-surface-raised px-3 py-2 text-xs shadow-float">
                        <p className="font-medium text-fg-primary">
                          {slice.label}
                        </p>
                        <p className="font-mono text-fg-secondary tabular-nums">
                          {format(slice.value)} ·{' '}
                          {formatPercent(slice.value / total)}
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <table className="w-full min-w-0 text-xs">
            <caption className="sr-only">{title}</caption>
            <tbody>
              {visible.map((slice) => (
                <tr key={slice.key}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-2 shrink-0 rounded-[2px]',
                          TONE_BG[slice.tone],
                        )}
                      />
                      <span
                        className="truncate font-mono text-fg-primary"
                        title={slice.label}
                      >
                        {slice.label}
                      </span>
                    </span>
                  </th>
                  <td className="py-1 pr-3 text-right font-mono whitespace-nowrap text-fg-primary tabular-nums">
                    {format(slice.value)}
                  </td>
                  <td className="w-12 py-1 text-right font-mono text-fg-tertiary tabular-nums">
                    {formatPercent(slice.value / total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56">
          <EmptyWell label="No usage to split" />
        </div>
      )}
    </Panel>
  );
};
