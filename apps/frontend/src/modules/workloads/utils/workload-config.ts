import type { Workload, WorkloadConfig } from '@acceleratio/shared';

/** Limits the API applies when `cpu_max` / `ram_max` are unset. */
export const DEFAULT_CPU_MAX = 1;
export const DEFAULT_RAM_MAX = 1024;

export const formatCpu = (cpu: number) => `${cpu} vCPU`;

export const formatMemory = (mib: number) =>
  mib % 1024 === 0 ? `${mib / 1024} GiB` : `${mib} MiB`;

/**
 * The config the service is heading to: pending changes when there are any,
 * otherwise what the cluster runs. Every workload has at least one of them.
 */
export const effectiveConfig = (workload: Workload): WorkloadConfig =>
  (workload.draft_config ?? workload.active_version?.config)!;

/** Edits on a deployed service that the next deploy applies. */
export const hasPendingChanges = (workload: Workload) =>
  workload.draft_config !== null && workload.active_version !== null;
