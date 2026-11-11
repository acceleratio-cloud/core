import { cn } from '@/lib/utils';
import { formatBytes } from '@/modules/observability/utils/format';
import type {
  VolumeFill,
  VolumeFillLevel,
} from '@/modules/workloads/utils/volume-usage';

const BAR_TONE: Record<VolumeFillLevel, string> = {
  ok: 'bg-status-success',
  warning: 'bg-status-warning',
  critical: 'bg-status-danger',
};

export const FILL_TEXT_TONE: Record<VolumeFillLevel, string> = {
  ok: 'text-fg-secondary',
  warning: 'text-status-warning',
  critical: 'text-status-danger',
};

/** How full a volume is: green, amber from 85%, red from 95%. */
export const VolumeUsageBar = ({
  fill,
  label,
  className,
}: {
  fill: VolumeFill;
  label: string;
  className?: string;
}) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(fill.ratio * 100)}
    aria-valuetext={`${formatBytes(fill.usedBytes)} of ${formatBytes(fill.capacityBytes)} used`}
    className={cn(
      'h-1 overflow-hidden rounded-full bg-edge-default',
      className,
    )}
  >
    <div
      // A sliver stays visible so an almost empty volume still reads as a bar.
      style={{ width: `${Math.max(fill.ratio * 100, 2)}%` }}
      className={cn('h-full rounded-full', BAR_TONE[fill.level])}
    />
  </div>
);
