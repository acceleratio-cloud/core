import { cn } from '@/lib/utils';
import { formatTimestamp, type ValueFormatter } from '../utils/format';
import { TONE_BG, type ChartSeries } from '../utils/series';

type TooltipEntry = { dataKey?: unknown; value?: unknown };

type ChartTooltipProps = {
  active?: boolean;
  label?: unknown;
  payload?: readonly TooltipEntry[];
  series: ChartSeries[];
  format: ValueFormatter;
  /** Adds a Total row, for stacked charts. */
  showTotal?: boolean;
};

/**
 * Crosshair readout shared by the time-series panels: the timestamp, then one
 * row per series in legend order. Values wear text tokens; the swatch carries
 * identity.
 */
export const ChartTooltip = ({
  active,
  label,
  payload,
  series,
  format,
  showTotal = false,
}: ChartTooltipProps) => {
  if (!active || !payload?.length || typeof label !== 'number') {
    return null;
  }

  const values = new Map(
    payload.map((entry) => [String(entry.dataKey), Number(entry.value ?? 0)]),
  );
  const rows = series.filter((item) => values.has(item.key));
  const total = rows.reduce(
    (sum, item) => sum + (values.get(item.key) ?? 0),
    0,
  );

  return (
    <div className="min-w-44 rounded-lg border border-edge-default bg-surface-raised px-3 py-2 text-xs shadow-float">
      <p className="mb-1.5 font-mono text-[11px] text-fg-tertiary tabular-nums">
        {formatTimestamp(label)}
      </p>
      <ul className="flex flex-col gap-1">
        {[...rows].reverse().map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'h-0.5 w-2.5 shrink-0 rounded-full',
                TONE_BG[item.tone],
              )}
            />
            <span
              className="max-w-40 truncate text-fg-secondary"
              title={item.label}
            >
              {item.label}
            </span>
            <span className="ml-auto pl-4 font-mono text-fg-primary tabular-nums">
              {format(values.get(item.key) ?? 0)}
            </span>
          </li>
        ))}
      </ul>
      {showTotal && rows.length > 1 ? (
        <p className="mt-1.5 flex items-center border-t border-edge-subtle pt-1.5">
          <span className="font-medium text-fg-secondary">Total</span>
          <span className="ml-auto pl-4 font-mono font-medium text-fg-primary tabular-nums">
            {format(total)}
          </span>
        </p>
      ) : null}
    </div>
  );
};
