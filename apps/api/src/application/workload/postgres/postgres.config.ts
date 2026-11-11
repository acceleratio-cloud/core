import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import {
  POSTGRES_VERSIONS,
  type PostgresConfig,
  type PostgresVersion,
} from '@acceleratio/shared';
import {
  normalizeCpuMax,
  normalizeRamMax,
  VOLUME_SIZE_MAX,
  VOLUME_SIZE_MIN,
} from '../docker/docker-workload.config';

export const DEFAULT_POSTGRES_VERSION: PostgresVersion = '17';
export const DEFAULT_POSTGRES_SIZE_GB = 10;
export const LOCKED_POSTGRES_MESSAGE =
  'PostgreSQL version and storage profile cannot change after creation';
export const SHRINK_DISK_MESSAGE = 'The disk can only grow';

type ConfigInput = Partial<Record<keyof PostgresConfig, unknown>>;

const normalizeVersion = (value: unknown): PostgresVersion => {
  if (value === undefined) {
    return DEFAULT_POSTGRES_VERSION;
  }

  if (!POSTGRES_VERSIONS.includes(value as PostgresVersion)) {
    throw new BadRequestException(
      `postgres_version must be one of ${POSTGRES_VERSIONS.join(', ')}`,
    );
  }

  return value as PostgresVersion;
};

const normalizeSize = (value: unknown): number => {
  if (value === undefined) {
    return DEFAULT_POSTGRES_SIZE_GB;
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < VOLUME_SIZE_MIN ||
    value > VOLUME_SIZE_MAX
  ) {
    throw new BadRequestException(
      `size_gb must be a whole number between ${VOLUME_SIZE_MIN} and ${VOLUME_SIZE_MAX}`,
    );
  }

  return value;
};

const normalizeStorageClassId = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('storage_class_id must be a string');
  }

  return value;
};

const normalizeBackups = (value: unknown): boolean | undefined => {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new BadRequestException('backups must be true or false');
  }

  return value;
};

/** Backups are on unless a version turned them off. */
export const backupsEnabled = (config: PostgresConfig | null): boolean =>
  config?.backups !== false;

/** Absent CPU/RAM stay absent, so the defaults apply and compare equal. */
export const normalizePostgresConfig = (input: unknown): PostgresConfig => {
  const value = (
    typeof input === 'object' && input !== null ? input : {}
  ) as ConfigInput;
  const cpu = normalizeCpuMax(value.cpu_max);
  const ram = normalizeRamMax(value.ram_max);
  const backups = normalizeBackups(value.backups);

  return {
    postgres_version: normalizeVersion(value.postgres_version),
    size_gb: normalizeSize(value.size_gb),
    storage_class_id: normalizeStorageClassId(value.storage_class_id),
    ...(cpu === undefined ? {} : { cpu_max: cpu }),
    ...(ram === undefined ? {} : { ram_max: ram }),
    ...(backups === undefined ? {} : { backups }),
  };
};

/**
 * Applies an update to the current config. CPU and memory change, the disk
 * only grows; the version and storage profile may be repeated unchanged.
 */
export const updatePostgresConfig = (
  current: PostgresConfig,
  input: unknown,
): PostgresConfig => {
  const value = (
    typeof input === 'object' && input !== null ? input : {}
  ) as ConfigInput;
  const next = normalizePostgresConfig({
    postgres_version: current.postgres_version,
    size_gb: 'size_gb' in value ? value.size_gb : current.size_gb,
    storage_class_id: current.storage_class_id,
    cpu_max: 'cpu_max' in value ? value.cpu_max : current.cpu_max,
    ram_max: 'ram_max' in value ? value.ram_max : current.ram_max,
    backups: 'backups' in value ? value.backups : current.backups,
  });

  if (
    ('postgres_version' in value &&
      value.postgres_version !== current.postgres_version) ||
    ('storage_class_id' in value &&
      (value.storage_class_id ?? null) !== current.storage_class_id)
  ) {
    throw new BadRequestException(LOCKED_POSTGRES_MESSAGE);
  }

  // A volume cannot shrink: the data could no longer fit.
  if (next.size_gb < current.size_gb) {
    throw new BadRequestException(SHRINK_DISK_MESSAGE);
  }

  return next;
};

export const ALLOWED_CIDRS_MAX = 20;
export const NODE_PORT_MIN = 30000;
export const NODE_PORT_MAX = 32767;

/** `1.2.3.4`, `1.2.3.0/24` or an IPv6 network; a bare address gets /32 or /128. */
const normalizeCidr = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  const [address, prefix, extra] = text.split('/');
  const version = isIP(address ?? '');
  const max = version === 6 ? 128 : 32;
  const bits = prefix === undefined ? max : Number(prefix);

  if (
    version === 0 ||
    extra !== undefined ||
    !/^\d{1,3}$/.test(prefix ?? String(max)) ||
    bits > max
  ) {
    throw new BadRequestException(
      `"${text.slice(0, 64)}" is not an IP address or network such as 203.0.113.0/24`,
    );
  }

  return `${address}/${bits}`;
};

export const normalizeAllowedCidrs = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException(
      'allowed_cidrs must list at least one network; 0.0.0.0/0 allows everyone',
    );
  }

  const cidrs = [...new Set(value.map(normalizeCidr))];

  if (cidrs.length > ALLOWED_CIDRS_MAX) {
    throw new BadRequestException(
      `allowed_cidrs can list at most ${ALLOWED_CIDRS_MAX} networks`,
    );
  }

  return cidrs;
};

export const normalizeNodePort = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < NODE_PORT_MIN ||
    value > NODE_PORT_MAX
  ) {
    throw new BadRequestException(
      `node_port must be a whole number from ${NODE_PORT_MIN} to ${NODE_PORT_MAX}`,
    );
  }

  return value;
};
