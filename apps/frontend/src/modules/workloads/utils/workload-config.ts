import type {
  DockerWorkloadConfig,
  DockerWorkloadVolume,
  Workload,
} from '@acceleratio/shared';

/** Limits the API applies when `cpu_max` / `ram_max` are unset. */
export const DEFAULT_CPU_MAX = 1;
export const DEFAULT_RAM_MAX = 1024;
/** Pods a service runs when `replicas` is unset, and the range the API accepts. */
export const DEFAULT_REPLICAS = 1;
export const REPLICAS_MIN = 1;
export const REPLICAS_MAX = 10;

export const formatCpu = (cpu: number) => `${cpu} vCPU`;

export const formatReplicas = (replicas: number) =>
  `${replicas} ${replicas === 1 ? 'replica' : 'replicas'}`;

export const formatMemory = (mib: number) =>
  mib % 1024 === 0 ? `${mib / 1024} GiB` : `${mib} MiB`;

/**
 * The config a Docker service is heading to: pending changes when there are
 * any, otherwise what the cluster runs. Every Docker workload has at least one
 * of them. Only Docker views call this; the type selects the config shape.
 */
export const effectiveConfig = (workload: Workload): DockerWorkloadConfig =>
  (workload.draft_config ??
    workload.active_version?.config) as DockerWorkloadConfig;

/** Edits on a deployed service that the next deploy applies. */
export const hasPendingChanges = (workload: Workload) =>
  workload.draft_config !== null && workload.active_version !== null;

/** Volume limits the API accepts. Sizes are GiB. */
export const VOLUMES_MAX = 10;
export const VOLUME_SIZE_MIN = 1;
export const VOLUME_SIZE_MAX = 100;
export const DEFAULT_VOLUME_SIZE = 10;
export const MOUNT_PATH_MAX_LENGTH = 255;

export const formatVolumeSize = (gib: number) => `${gib} GiB`;

/** The path as the API stores it: trimmed, without a trailing slash. */
export const cleanMountPath = (value: string) =>
  value.trim().replace(/\/+$/, '');

/**
 * Mirrors the API's mount path rules so mistakes show while typing. `taken`
 * are the paths of the service's other volumes.
 */
export const mountPathProblem = (
  value: string,
  taken: string[],
): string | null => {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Enter the path to mount the volume at.';
  }

  if (!trimmed.startsWith('/')) {
    return 'Use an absolute path, starting with /.';
  }

  const path = cleanMountPath(trimmed);

  if (!path) {
    return 'A volume cannot be mounted at /.';
  }

  if (path.length > MOUNT_PATH_MAX_LENGTH) {
    return `Keep it under ${MOUNT_PATH_MAX_LENGTH + 1} characters.`;
  }

  if (
    path
      .slice(1)
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return 'Remove empty, . and .. parts from the path.';
  }

  if (path.includes(':')) {
    return 'A mount path cannot contain :.';
  }

  if (taken.includes(path)) {
    return 'Another volume is already mounted here.';
  }

  return null;
};

/** What the next deploy does to a volume, or null when it is applied. */
export type VolumeChange = 'new' | 'moved' | null;

export const volumeChange = (
  workload: Workload,
  volume: DockerWorkloadVolume,
): VolumeChange => {
  if (workload.draft_config === null) {
    return null;
  }

  const applied = (
    workload.active_version?.config as DockerWorkloadConfig | undefined
  )?.volumes?.find(({ id }) => id === volume.id);

  if (!applied) {
    return 'new';
  }

  return applied.mount_path === volume.mount_path ? null : 'moved';
};

/** Volumes the active version has and the pending changes drop. */
export const removedVolumes = (workload: Workload): DockerWorkloadVolume[] => {
  if (workload.draft_config === null) {
    return [];
  }

  const kept = new Set(
    ((workload.draft_config as DockerWorkloadConfig).volumes ?? []).map(
      ({ id }) => id,
    ),
  );

  return (
    (workload.active_version?.config as DockerWorkloadConfig | undefined)
      ?.volumes ?? []
  ).filter(({ id }) => !kept.has(id));
};
