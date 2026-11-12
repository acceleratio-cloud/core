import type {
  DockerWorkloadVolume,
  VolumeUsage,
  Workload,
} from '@acceleratio/shared';
import { effectiveConfig, removedVolumes } from './workload-config';

/** From here a volume is flagged on the canvas and in its settings. */
export const VOLUME_WARNING_RATIO = 0.85;
/** ext4 on a Longhorn volume fails writes with ENOSPC once full, so this close it is critical. */
export const VOLUME_CRITICAL_RATIO = 0.95;

export type VolumeFillLevel = 'ok' | 'warning' | 'critical';

export interface VolumeFill {
  usedBytes: number;
  capacityBytes: number;
  /** 0 to 1. */
  ratio: number;
  level: VolumeFillLevel;
}

/** How full a disk of `sizeGb` is; null until the kubelet has reported it. */
export const volumeFill = (
  sizeGb: number,
  usage: VolumeUsage | undefined,
): VolumeFill | null => {
  if (!usage) {
    return null;
  }

  const capacityBytes = usage.capacity_bytes ?? sizeGb * 1024 ** 3;
  const ratio =
    capacityBytes > 0 ? Math.min(usage.used_bytes / capacityBytes, 1) : 0;

  return {
    usedBytes: usage.used_bytes,
    capacityBytes,
    ratio,
    level:
      ratio >= VOLUME_CRITICAL_RATIO
        ? 'critical'
        : ratio >= VOLUME_WARNING_RATIO
          ? 'warning'
          : 'ok',
  };
};

export const formatFillPercent = (fill: VolumeFill) =>
  `${Math.floor(fill.ratio * 100)}%`;

/** A reading this old is dropped rather than shown as current. */
export const VOLUME_USAGE_MAX_AGE_MS = 3 * 60_000;

/** True once the last good reading (`0` for none) is too old to show. */
export const isUsageStale = (loadedAt: number, now: number) =>
  now - loadedAt > VOLUME_USAGE_MAX_AGE_MS;

/** Only services with volumes and databases have disks to read. */
export const projectHasDisks = (workloads: Workload[]) =>
  workloads.some(
    (workload) =>
      workload.type === 'postgres' ||
      (effectiveConfig(workload)?.volumes?.length ?? 0) > 0 ||
      removedVolumes(workload).length > 0,
  );

export interface VolumeWithFill {
  volume: DockerWorkloadVolume;
  fill: VolumeFill | null;
  /** The draft drops it; it stays mounted until the next deploy. */
  removed: boolean;
}

/**
 * The volumes a service card shows, and those over the warning threshold,
 * fullest first. A volume the draft removes is still mounted, so it can warn.
 */
export const serviceVolumeFills = (
  workload: Workload,
  usage: ReadonlyMap<string, VolumeUsage>,
) => {
  const withFill =
    (removed: boolean) =>
    (volume: DockerWorkloadVolume): VolumeWithFill => ({
      volume,
      fill: volumeFill(
        volume.size_gb,
        volume.id ? usage.get(volume.id) : undefined,
      ),
      removed,
    });
  const items = (effectiveConfig(workload)?.volumes ?? []).map(withFill(false));
  const full = [...items, ...removedVolumes(workload).map(withFill(true))]
    .filter(({ fill }) => fill && fill.level !== 'ok')
    .sort((a, b) => (b.fill?.ratio ?? 0) - (a.fill?.ratio ?? 0));

  return { items, full };
};
