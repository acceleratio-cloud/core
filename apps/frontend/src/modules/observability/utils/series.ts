import type {
  MetricsPoint,
  MetricsRange,
  MetricsSignal,
} from '@acceleratio/shared';

// The console only imports types from @acceleratio/shared (the package is
// not bundled at runtime), so the contract's constants are mirrored here.

/** `OTHER_METRICS_SERIES_KEY`: pods without a known workload. */
export const OTHER_SERIES_KEY = 'other';

/** `METRICS_RANGES`, in picker order. */
export const METRICS_RANGES: readonly MetricsRange[] = [
  '15m',
  '1h',
  '6h',
  '24h',
  '7d',
];

/** A categorical slot, or the neutral used for Other. */
export type ChartTone =
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6'
  | 'other';

/** Background classes for legend swatches and title dots. */
export const TONE_BG: Record<ChartTone, string> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  other: 'bg-fg-tertiary',
};

/** The CSS color of a tone, for SVG `stroke` and `fill` attributes. */
export const toneColor = (tone: ChartTone) =>
  tone === 'other' ? 'var(--fg-tertiary)' : `var(--${tone})`;

export type ChartSeries = {
  key: string;
  label: string;
  tone: ChartTone;
  points: MetricsPoint[];
};

export type ChartRow = { t: number } & Record<string, number>;

/** Categorical slots, in assignment order. Never cycled. */
export const CHART_TONES: ChartTone[] = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
];

/**
 * Gives each workload a fixed color by its position in the workload list, so
 * a service keeps its color in every panel and across range changes. With
 * more services than slots, the first ones keep a color and the rest fold
 * into a neutral Other series.
 */
export const assignSeriesTones = (
  workloadIds: string[],
): Map<string, ChartTone> => {
  const colored =
    workloadIds.length > CHART_TONES.length
      ? workloadIds.slice(0, CHART_TONES.length - 1)
      : workloadIds;

  return new Map(colored.map((id, index) => [id, CHART_TONES[index]]));
};

const sumInto = (target: Map<number, number>, points: MetricsPoint[]) => {
  for (const [t, value] of points) {
    target.set(t, (target.get(t) ?? 0) + value);
  }
};

/** Splits a signal into colored per-service series plus at most one Other. */
export const toServiceSeries = (
  signal: MetricsSignal,
  tones: Map<string, ChartTone>,
): ChartSeries[] => {
  const series: ChartSeries[] = [];
  const other = new Map<number, number>();

  for (const item of signal.by_workload) {
    const tone =
      item.key === OTHER_SERIES_KEY ? undefined : tones.get(item.key);

    if (tone) {
      series.push({ ...item, tone });
    } else {
      sumInto(other, item.points);
    }
  }

  if (other.size > 0) {
    series.push({
      key: OTHER_SERIES_KEY,
      label: 'Other',
      tone: 'other',
      points: [...other.entries()].sort(([a], [b]) => a - b),
    });
  }

  return series;
};

/**
 * One row per timestamp with a column per series, the shape Recharts plots.
 * A series without a sample at a timestamp reads 0 there, so stacks stay
 * continuous when a pod starts or stops inside the window.
 */
export const toChartRows = (series: ChartSeries[]): ChartRow[] => {
  const rows = new Map<number, ChartRow>();

  for (const item of series) {
    for (const [t, value] of item.points) {
      let row = rows.get(t);

      if (!row) {
        row = { t } as ChartRow;
        rows.set(t, row);
      }

      row[item.key] = value;
    }
  }

  const sorted = [...rows.values()].sort((a, b) => a.t - b.t);

  for (const row of sorted) {
    for (const item of series) {
      row[item.key] ??= 0;
    }
  }

  return sorted;
};

export type SeriesStats = { mean: number; max: number; last: number };

export const seriesStats = (points: MetricsPoint[]): SeriesStats | null => {
  if (points.length === 0) {
    return null;
  }

  let sum = 0;
  let max = -Infinity;

  for (const [, value] of points) {
    sum += value;
    max = Math.max(max, value);
  }

  return { mean: sum / points.length, max, last: points[points.length - 1][1] };
};
