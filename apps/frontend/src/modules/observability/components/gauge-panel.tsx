'use client';

import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Pie, PieChart, ResponsiveContainer } from 'recharts';

import { cn } from '@/lib/utils';
import { formatPercent } from '../utils/format';
import { Panel } from './panel';

/** Saturation bands: under 70% is healthy, 70–90% high, over 90% critical. */
const WARNING_AT = 0.7;
const CRITICAL_AT = 0.9;

const START_ANGLE = 225;
const END_ANGLE = -45;

type Level = 'healthy' | 'high' | 'critical';

const LEVELS: Record<
  Level,
  { label: string; color: string; text: string; icon: typeof CircleCheck }
> = {
  healthy: {
    label: 'Healthy',
    color: 'var(--status-success)',
    text: 'text-status-success',
    icon: CircleCheck,
  },
  high: {
    label: 'High',
    color: 'var(--status-warning)',
    text: 'text-status-warning',
    icon: TriangleAlert,
  },
  critical: {
    label: 'Critical',
    color: 'var(--status-danger)',
    text: 'text-status-danger',
    icon: OctagonAlert,
  },
};

const levelOf = (ratio: number): Level =>
  ratio >= CRITICAL_AT ? 'critical' : ratio >= WARNING_AT ? 'high' : 'healthy';

// Recharts reads each sector's `fill` from its data item.
const BANDS = [
  { value: WARNING_AT, fill: 'var(--status-success)' },
  { value: CRITICAL_AT - WARNING_AT, fill: 'var(--status-warning)' },
  { value: 1 - CRITICAL_AT, fill: 'var(--status-danger)' },
];

type GaugePanelProps = {
  title: string;
  /** Used share of the reference, 0–1; null when either side is unknown. */
  ratio: number | null;
  /** What the ratio is measured against and the two figures. */
  caption: string;
};

/**
 * A 270° gauge for saturation. The arc takes the status color of its band and
 * the center repeats the level as a word and an icon, so the reading never
 * depends on color alone. A thin outer ring shows where the bands start.
 */
export const GaugePanel = ({ title, ratio, caption }: GaugePanelProps) => {
  const clamped = ratio === null ? 0 : Math.min(Math.max(ratio, 0), 1);
  const level = ratio === null ? null : LEVELS[levelOf(ratio)];
  const Icon = level?.icon;

  return (
    <Panel title={title} wellClassName="h-52">
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Pie
              data={BANDS}
              dataKey="value"
              startAngle={START_ANGLE}
              endAngle={END_ANGLE}
              innerRadius="86%"
              outerRadius="90%"
              stroke="none"
              fillOpacity={0.55}
              isAnimationActive={false}
            />
            <Pie
              data={[{ value: 1 }]}
              dataKey="value"
              startAngle={START_ANGLE}
              endAngle={END_ANGLE}
              innerRadius="66%"
              outerRadius="80%"
              fill="var(--surface-muted)"
              stroke="none"
              isAnimationActive={false}
            />
            {level ? (
              <Pie
                data={[
                  { value: clamped, fill: level.color },
                  { value: 1 - clamped, fill: 'transparent' },
                ]}
                dataKey="value"
                startAngle={START_ANGLE}
                endAngle={END_ANGLE}
                innerRadius="66%"
                outerRadius="80%"
                cornerRadius={4}
                stroke="none"
                animationDuration={600}
                animationEasing="ease-out"
              />
            ) : null}
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="pointer-events-none relative flex h-full flex-col items-center justify-center gap-1.5 pt-2">
        <p className="font-mono text-2xl leading-none font-medium tracking-tight text-fg-primary tabular-nums">
          {ratio === null ? '—' : formatPercent(ratio)}
        </p>
        {level && Icon ? (
          <p
            className={cn(
              'flex items-center gap-1 text-[11px] font-medium',
              level.text,
            )}
          >
            <Icon aria-hidden="true" strokeWidth={1.75} className="size-3" />
            {level.label}
          </p>
        ) : (
          <p className="text-[11px] text-fg-tertiary">No reference</p>
        )}
      </div>

      <p
        className="absolute inset-x-0 bottom-2.5 truncate px-3 text-center font-mono text-[11px] text-fg-tertiary tabular-nums"
        title={caption}
      >
        {caption}
      </p>
    </Panel>
  );
};
