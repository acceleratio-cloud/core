import type { DockerWorkloadConfig, Workload } from '@acceleratio/shared';

/** Limits the API applies when `cpu_max` / `ram_max` are unset. */
export const DEFAULT_CPU_MAX = 1;
export const DEFAULT_RAM_MAX = 1024;

export const formatCpu = (cpu: number) => `${cpu} vCPU`;

export const formatMemory = (mib: number) =>
  mib % 1024 === 0 ? `${mib / 1024} GiB` : `${mib} MiB`;

/** Absent means the default limit, null means no limit. */
export const formatCpuLimit = (cpu: number | null | undefined) =>
  cpu === null ? 'No limit' : formatCpu(cpu ?? DEFAULT_CPU_MAX);

export const formatMemoryLimit = (mib: number | null | undefined) =>
  mib === null ? 'No limit' : formatMemory(mib ?? DEFAULT_RAM_MAX);

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
