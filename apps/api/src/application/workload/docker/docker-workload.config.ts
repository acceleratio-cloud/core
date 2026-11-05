import { BadRequestException } from '@nestjs/common';
import type {
  DockerWorkloadConfig,
  EnvVar,
  WorkloadConfig,
} from '@acceleratio/shared';

/** Limits applied when a config leaves `cpu_max` / `ram_max` unset. */
export const DEFAULT_CPU_MAX = 1;
export const DEFAULT_RAM_MAX = 1024;

export const CPU_MAX_MIN = 0.01;
export const CPU_MAX_MAX = 64;
export const RAM_MAX_MIN = 16;
export const RAM_MAX_MAX = 262144;
/** Pods a service runs when `replicas` is unset. */
export const DEFAULT_REPLICAS = 1;
export const REPLICAS_MIN = 1;
export const REPLICAS_MAX = 10;
export const ARGS_MAX_ITEMS = 64;
export const ARG_MAX_LENGTH = 4096;
export const ENV_MAX_ITEMS = 256;
export const ENV_KEY_MAX_LENGTH = 256;
/** Keys plus values, well below the 1 MiB a Kubernetes Secret may hold. */
export const ENV_MAX_BYTES = 512 * 1024;
/** POSIX shell variable names; Kubernetes skips anything else in envFrom. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type ArgsField = 'entrypoint' | 'command';

/**
 * vCPU kept to millicore precision, the finest Kubernetes resolves. Null
 * removes the limit; absent keeps the default.
 */
const normalizeCpuMax = (value: unknown): number | null | undefined => {
  if (value === undefined || value === null) {
    return value;
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

/** MiB. Null removes the limit; absent keeps the default. */
const normalizeRamMax = (value: unknown): number | null | undefined => {
  if (value === undefined || value === null) {
    return value;
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
 * Pod count. The default is kept absent, so a config that never set it
 * compares equal to one that set it back to one.
 */
const normalizeReplicas = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < REPLICAS_MIN ||
    value > REPLICAS_MAX
  ) {
    throw new BadRequestException(
      `replicas must be a whole number between ${REPLICAS_MIN} and ${REPLICAS_MAX}`,
    );
  }

  return value === DEFAULT_REPLICAS ? undefined : value;
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
 * Variables keep the user's order and their values verbatim. An empty list
 * means "no variables" and is omitted like an empty argument list.
 */
const normalizeEnv = (value: unknown): EnvVar[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new BadRequestException('env must be a list of variables');
  }

  if (value.length > ENV_MAX_ITEMS) {
    throw new BadRequestException(
      `env accepts at most ${ENV_MAX_ITEMS} variables`,
    );
  }

  const seen = new Set<string>();
  let bytes = 0;
  const vars = value.map((item: unknown): EnvVar => {
    const candidate = item as Record<string, unknown> | null;

    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      typeof candidate.key !== 'string' ||
      typeof candidate.value !== 'string'
    ) {
      throw new BadRequestException(
        'Each env variable must have a string key and value',
      );
    }

    const { key, value: varValue } = candidate as {
      key: string;
      value: string;
    };

    if (key.length > ENV_KEY_MAX_LENGTH || !ENV_KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        `Invalid env variable name "${key.slice(0, 64)}": use letters, digits and underscores, not starting with a digit`,
      );
    }

    if (seen.has(key)) {
      throw new BadRequestException(`Duplicate env variable ${key}`);
    }

    seen.add(key);
    bytes += Buffer.byteLength(key) + Buffer.byteLength(varValue);

    return { key, value: varValue };
  });

  if (bytes > ENV_MAX_BYTES) {
    throw new BadRequestException(
      `env variables must total at most ${ENV_MAX_BYTES / 1024} KiB`,
    );
  }

  return vars.length === 0 ? undefined : vars;
};

/**
 * Validates a Docker config and keeps only the known keys. An absent limit
 * means the default and stays absent; a null limit means "no limit" and is
 * kept. Empty entrypoint/command/env lists are omitted, so a config that never
 * set them compares equal to one that cleared them. A legacy `port` from
 * JSONB is dropped here and never reaches the API contract.
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
  const replicas = normalizeReplicas(candidate?.replicas);
  const entrypoint = normalizeArgs('entrypoint', candidate?.entrypoint);
  const command = normalizeArgs('command', candidate?.command);
  const env = normalizeEnv(candidate?.env);

  if (cpuMax !== undefined) {
    normalized.cpu_max = cpuMax;
  }

  if (ramMax !== undefined) {
    normalized.ram_max = ramMax;
  }

  if (replicas !== undefined) {
    normalized.replicas = replicas;
  }

  if (entrypoint !== undefined) {
    normalized.entrypoint = entrypoint;
  }

  if (command !== undefined) {
    normalized.command = command;
  }

  if (env !== undefined) {
    normalized.env = env;
  }

  return normalized;
};

/**
 * The config a new service starts with. Limits the request leaves out are
 * stored as null, so new services run without CPU or memory limits. Configs
 * stored before this default keep the absent-means-1-vCPU/1-GiB meaning.
 */
export const newDockerConfig = (
  config: WorkloadConfig | undefined,
): DockerWorkloadConfig => {
  const normalized = normalizeDockerConfig(config);

  return {
    ...normalized,
    cpu_max: normalized.cpu_max ?? null,
    ram_max: normalized.ram_max ?? null,
  };
};

/**
 * The config as the API shows it: variable names stay, values never leave the
 * server outside `GET …/env`, so lists, events and version history cannot leak
 * them.
 */
export const redactDockerConfig = (
  config: WorkloadConfig,
): DockerWorkloadConfig => {
  const { env, ...rest } = config as DockerWorkloadConfig;

  return env?.length ? { ...rest, env_keys: env.map(({ key }) => key) } : rest;
};

/** True when an update leaves `env` out, which keeps the current variables. */
export const omitsEnv = (config: WorkloadConfig | undefined): boolean =>
  (config as Record<string, unknown> | null | undefined)?.env == null;
