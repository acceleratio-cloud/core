import { BadRequestException } from '@nestjs/common';
import type { DockerWorkloadConfig, WorkloadConfig } from '@acceleratio/shared';

/** Limits applied when a config leaves `cpu_max` / `ram_max` unset. */
export const DEFAULT_CPU_MAX = 1;
export const DEFAULT_RAM_MAX = 1024;

export const CPU_MAX_MIN = 0.01;
export const CPU_MAX_MAX = 64;
export const RAM_MAX_MIN = 16;
export const RAM_MAX_MAX = 262144;
export const ARGS_MAX_ITEMS = 64;
export const ARG_MAX_LENGTH = 4096;

type ArgsField = 'entrypoint' | 'command';

/** vCPU kept to millicore precision, the finest Kubernetes resolves. */
const normalizeCpuMax = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < CPU_MAX_MIN ||
    value > CPU_MAX_MAX
  ) {
    throw new BadRequestException(
      `cpu_max must be a number of vCPU between ${CPU_MAX_MIN} and ${CPU_MAX_MAX}`,
    );
  }

  return Math.round(value * 1000) / 1000;
};

const normalizeRamMax = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < RAM_MAX_MIN ||
    value > RAM_MAX_MAX
  ) {
    throw new BadRequestException(
      `ram_max must be a whole number of MiB between ${RAM_MAX_MIN} and ${RAM_MAX_MAX}`,
    );
  }

  return value;
};

/**
 * Arguments are kept verbatim: an empty string or surrounding spaces can be a
 * meaningful argument. An empty list means "use the image default".
 */
const normalizeArgs = (
  field: ArgsField,
  value: unknown,
): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new BadRequestException(`${field} must be a list of strings`);
  }

  if (value.length > ARGS_MAX_ITEMS) {
    throw new BadRequestException(
      `${field} accepts at most ${ARGS_MAX_ITEMS} arguments`,
    );
  }

  if (value.some((item: string) => item.length > ARG_MAX_LENGTH)) {
    throw new BadRequestException(
      `Each ${field} argument must be at most ${ARG_MAX_LENGTH} characters`,
    );
  }

  return value.length === 0 ? undefined : [...value];
};

/**
 * Validates a Docker config and keeps only the known keys. Unset optional
 * keys are omitted rather than stored as null, so a config that never used
 * them compares equal to one that cleared them. A legacy `port` from JSONB is
 * dropped here and never reaches the API contract.
 */
export const normalizeDockerConfig = (
  config: WorkloadConfig | undefined,
): DockerWorkloadConfig => {
  const candidate = config as Record<string, unknown> | null | undefined;
  const image = candidate?.docker_image;

  if (typeof image !== 'string' || !image.trim()) {
    throw new BadRequestException('docker_image is required');
  }

  const normalized: DockerWorkloadConfig = { docker_image: image.trim() };
  const cpuMax = normalizeCpuMax(candidate?.cpu_max);
  const ramMax = normalizeRamMax(candidate?.ram_max);
  const entrypoint = normalizeArgs('entrypoint', candidate?.entrypoint);
  const command = normalizeArgs('command', candidate?.command);

  if (cpuMax !== undefined) {
    normalized.cpu_max = cpuMax;
  }

  if (ramMax !== undefined) {
    normalized.ram_max = ramMax;
  }

  if (entrypoint !== undefined) {
    normalized.entrypoint = entrypoint;
  }

  if (command !== undefined) {
    normalized.command = command;
  }

  return normalized;
};
