import { BadRequestException } from '@nestjs/common';
import type {
  CreateStorageClassPayload,
  StorageClassParameters,
  StorageClassReclaimPolicy,
  StorageClassVolumeBindingMode,
  UpdateStorageClassPayload,
} from '@acceleratio/shared';
import { normalizeName } from '@/common/validation';

export const DESCRIPTION_MAX_LENGTH = 1000;
export const DEFAULT_REPLICATION = '000';
export const DEFAULT_RECLAIM_POLICY: StorageClassReclaimPolicy = 'Delete';
export const DEFAULT_VOLUME_BINDING_MODE: StorageClassVolumeBindingMode =
  'Immediate';
export const DEFAULT_ALLOW_VOLUME_EXPANSION = true;

export const LOCKED_SETTINGS_MESSAGE =
  'Storage settings cannot change after creation. Duplicate the class instead.';

const RECLAIM_POLICIES: readonly StorageClassReclaimPolicy[] = [
  'Delete',
  'Retain',
];
const VOLUME_BINDING_MODES: readonly StorageClassVolumeBindingMode[] = [
  'Immediate',
  'WaitForFirstConsumer',
];

const REPLICATION = /^[0-9]{3}$/;
// SeaweedFS disk tags and collection names end up in volume file names.
const TAG = /^[a-z0-9][a-z0-9_-]{0,31}$/;
// SeaweedFS TTL: a count and a unit (minute, hour, day, week, month, year).
const TTL = /^[1-9][0-9]{0,4}[mhdwMy]$/;

interface IntegerRange {
  min: number;
  max: number;
}

export const INTEGER_LIMITS = {
  cache_capacity_mb: { min: 0, max: 1_048_576 },
  concurrent_writers: { min: 1, max: 1024 },
  chunk_size_limit_mb: { min: 1, max: 1024 },
} satisfies Record<string, IntegerRange>;

const PARAMETER_KEYS: readonly (keyof StorageClassParameters)[] = [
  'replication',
  'disk_type',
  'collection',
  'ttl',
  'cache_capacity_mb',
  'concurrent_writers',
  'chunk_size_limit_mb',
  'writeback_cache',
];

const CREATE_KEYS = new Set([
  'name',
  'description',
  'parameters',
  'reclaim_policy',
  'volume_binding_mode',
  'allow_volume_expansion',
]);
const UPDATE_KEYS = new Set(['name', 'description', 'allow_volume_expansion']);

/**
 * Copies needed by a SeaweedFS replication code `xyz`: the original plus x
 * copies in other data centers, y on other racks and z on other servers.
 */
export const replicationCopies = (replication: string): number =>
  1 + Array.from(replication).reduce((sum, digit) => sum + Number(digit), 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new BadRequestException('Request body must be an object');
  }

  return value;
};

export const normalizeDescription = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('Description must be a string');
  }

  const trimmed = value.trim();

  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    throw new BadRequestException(
      `Keep the description under ${DESCRIPTION_MAX_LENGTH} characters`,
    );
  }

  return trimmed || null;
};

const normalizeBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${label} must be true or false`);
  }

  return value;
};

const normalizeOptionalTag = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || !TAG.test(value.trim())) {
    throw new BadRequestException(
      `${label} must be up to 32 lowercase letters, digits, '-' or '_'`,
    );
  }

  return value.trim();
};

const normalizeOptionalInteger = (
  value: unknown,
  label: string,
  { min, max }: IntegerRange,
): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new BadRequestException(
      `${label} must be a whole number from ${min} to ${max}`,
    );
  }

  return value;
};

const normalizeEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string,
): T => {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!allowed.includes(value as T)) {
    throw new BadRequestException(
      `${label} must be one of: ${allowed.join(', ')}`,
    );
  }

  return value as T;
};

export const normalizeParameters = (input: unknown): StorageClassParameters => {
  const value = input === undefined || input === null ? {} : input;

  if (!isRecord(value)) {
    throw new BadRequestException('Parameters must be an object');
  }

  for (const key of Object.keys(value)) {
    if (!PARAMETER_KEYS.includes(key as keyof StorageClassParameters)) {
      throw new BadRequestException(`Unknown storage parameter: ${key}`);
    }
  }

  const replication =
    value.replication === undefined || value.replication === null
      ? DEFAULT_REPLICATION
      : value.replication;

  if (typeof replication !== 'string' || !REPLICATION.test(replication)) {
    throw new BadRequestException(
      'Replication must be a three-digit SeaweedFS code such as 000 or 001',
    );
  }

  let ttl: string | null = null;

  if (value.ttl !== undefined && value.ttl !== null && value.ttl !== '') {
    if (typeof value.ttl !== 'string' || !TTL.test(value.ttl.trim())) {
      throw new BadRequestException(
        'TTL must be a number and a unit (m, h, d, w, M, y), such as 7d',
      );
    }

    ttl = value.ttl.trim();
  }

  return {
    replication,
    disk_type: normalizeOptionalTag(value.disk_type, 'Disk type'),
    collection: normalizeOptionalTag(value.collection, 'Collection'),
    ttl,
    cache_capacity_mb: normalizeOptionalInteger(
      value.cache_capacity_mb,
      'Cache capacity',
      INTEGER_LIMITS.cache_capacity_mb,
    ),
    concurrent_writers: normalizeOptionalInteger(
      value.concurrent_writers,
      'Concurrent writers',
      INTEGER_LIMITS.concurrent_writers,
    ),
    chunk_size_limit_mb: normalizeOptionalInteger(
      value.chunk_size_limit_mb,
      'Chunk size limit',
      INTEGER_LIMITS.chunk_size_limit_mb,
    ),
    writeback_cache:
      value.writeback_cache === undefined || value.writeback_cache === null
        ? false
        : normalizeBoolean(value.writeback_cache, 'Write-back cache'),
  };
};

export interface NormalizedCreateStorageClass {
  name: string;
  description: string | null;
  parameters: StorageClassParameters;
  reclaim_policy: StorageClassReclaimPolicy;
  volume_binding_mode: StorageClassVolumeBindingMode;
  allow_volume_expansion: boolean;
}

export const normalizeCreatePayload = (
  payload: CreateStorageClassPayload | undefined,
): NormalizedCreateStorageClass => {
  const body = requireRecord(payload);

  for (const key of Object.keys(body)) {
    if (!CREATE_KEYS.has(key)) {
      throw new BadRequestException(`Unknown field: ${key}`);
    }
  }

  return {
    name: normalizeName(body.name),
    description: normalizeDescription(body.description),
    parameters: normalizeParameters(body.parameters),
    reclaim_policy: normalizeEnum(
      body.reclaim_policy,
      RECLAIM_POLICIES,
      DEFAULT_RECLAIM_POLICY,
      'Reclaim policy',
    ),
    volume_binding_mode: normalizeEnum(
      body.volume_binding_mode,
      VOLUME_BINDING_MODES,
      DEFAULT_VOLUME_BINDING_MODE,
      'Volume binding mode',
    ),
    allow_volume_expansion:
      body.allow_volume_expansion === undefined
        ? DEFAULT_ALLOW_VOLUME_EXPANSION
        : normalizeBoolean(body.allow_volume_expansion, 'Volume expansion'),
  };
};

export interface NormalizedUpdateStorageClass {
  name?: string;
  description?: string | null;
  allow_volume_expansion?: boolean;
}

/**
 * Only the display fields and volume expansion can change: Kubernetes
 * rejects updates to a StorageClass's parameters, reclaim policy and binding
 * mode, so those keys are refused instead of silently ignored.
 */
export const normalizeUpdatePayload = (
  payload: UpdateStorageClassPayload | undefined,
): NormalizedUpdateStorageClass => {
  const body = requireRecord(payload);

  for (const key of Object.keys(body)) {
    if (!UPDATE_KEYS.has(key)) {
      throw new BadRequestException(
        CREATE_KEYS.has(key)
          ? LOCKED_SETTINGS_MESSAGE
          : `Unknown field: ${key}`,
      );
    }
  }

  const result: NormalizedUpdateStorageClass = {};

  if (body.name !== undefined) {
    result.name = normalizeName(body.name);
  }

  if (body.description !== undefined) {
    result.description = normalizeDescription(body.description);
  }

  if (body.allow_volume_expansion !== undefined) {
    result.allow_volume_expansion = normalizeBoolean(
      body.allow_volume_expansion,
      'Volume expansion',
    );
  }

  return result;
};
