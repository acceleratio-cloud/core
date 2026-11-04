'use client';

import {
  CircleCheck,
  CircleDashed,
  OctagonAlert,
  TriangleAlert,
} from 'lucide-react';
import { Pie, PieChart } from 'recharts';

import { cn } from '@/lib/utils';
import { formatPercent } from '../utils/format';
import { Panel } from './panel';

/** Saturation bands: under 70% is healthy, 70–90% high, over 90% critical. */
const WARNING_AT = 0.7;
const CRITICAL_AT = 0.9;

/** A 240° dial, open at the bottom. */
const START_ANGLE = 210;
const END_ANGLE = -30;

/** The dial is drawn at a fixed size so it never fights the labels. */
const DIAL_SIZE = 152;

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

const TRACK = [{ value: 1, fill: 'var(--surface-muted)' }];

type GaugePanelProps = {
  title: string;
  /** Used share of the reference, 0–1; null when either side is unknown. */
  ratio: number | null;
  /** The two figures, such as `120m of 4 cores`. */
  caption: string;
  /** What the share is measured against (`of limit`, `of cluster`). */
  reference?: string;
};

/**
 * A saturation dial. The value arc takes the status color of its band, and
 * the level is repeated as a word and an icon, so the reading never depends
 * on color alone. A thin outer ring marks where the bands start.
 */
export const GaugePanel = ({
  title,
  ratio,
  caption,
  reference,
}: GaugePanelProps) => {
  const clamped = ratio === null ? 0 : Math.min(Math.max(ratio, 0), 1);
  const level = ratio === null ? null : LEVELS[levelOf(ratio)];
  const Icon = level?.icon ?? CircleDashed;
  const radius = DIAL_SIZE / 2;

  return (
    <Panel title={title} hint={reference} wellClassName="h-60">
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-3">
        <div className="relative size-38 shrink-0">
          <PieChart
            width={DIAL_SIZE}
            height={DIAL_SIZE}
            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          >
            <Pie
              data={BANDS}
              dataKey="value"
              cx={radius}
              cy={radius}
              startAngle={START_ANGLE}
              endAngle={END_ANGLE}
              innerRadius={radius - 4}
              outerRadius={radius - 1}
              stroke="none"
              fillOpacity={0.5}
              isAnimationActive={false}
            />
            <Pie
              data={TRACK}
              dataKey="value"
              cx={radius}
              cy={radius}
              startAngle={START_ANGLE}
              endAngle={END_ANGLE}
              innerRadius={radius - 20}
              outerRadius={radius - 8}
              cornerRadius={6}
              stroke="none"
              isAnimationActive={false}
            />
            {level && clamped > 0 ? (
              <Pie
                data={[
                  { value: clamped, fill: level.color },
                  { value: 1 - clamped, fill: 'transparent' },
                ]}
                dataKey="value"
                cx={radius}
                cy={radius}
                startAngle={START_ANGLE}
                endAngle={END_ANGLE}
                innerRadius={radius - 20}
                outerRadius={radius - 8}
                cornerRadius={6}
                stroke="none"
                animationDuration={600}
                animationEasing="ease-out"
              />
            ) : null}
          </PieChart>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 pt-1">
            <p className="font-mono text-[26px] leading-none font-medium tracking-tight text-fg-primary tabular-nums">
              {ratio === null ? '—' : formatPercent(ratio)}
            </p>
            <p
              className={cn(
                'flex items-center gap-1 text-[11px] leading-none font-medium',
                level ? level.text : 'text-fg-tertiary',
              )}
            >
              <Icon aria-hidden="true" strokeWidth={2} className="size-3" />
              {level ? level.label : 'No reference'}
            </p>
          </div>
        </div>

        <p
          className="max-w-full truncate font-mono text-[11px] text-fg-secondary tabular-nums"
          title={caption}
        >
          {caption}
        </p>
      </div>
    </Panel>
  );
};
