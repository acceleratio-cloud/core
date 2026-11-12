import { BadRequestException } from '@nestjs/common';
import type {
  CreateStorageClassPayload,
  StorageClassDataLocality,
  StorageClassFsType,
  StorageClassParameters,
  StorageClassReclaimPolicy,
  StorageClassVolumeBindingMode,
  UpdateStorageClassPayload,
} from '@acceleratio/shared';
import { normalizeName } from '@/common/validation';

export const DESCRIPTION_MAX_LENGTH = 1000;
export const DEFAULT_RECLAIM_POLICY: StorageClassReclaimPolicy = 'Delete';
export const DEFAULT_VOLUME_BINDING_MODE: StorageClassVolumeBindingMode =
  'Immediate';
export const DEFAULT_ALLOW_VOLUME_EXPANSION = true;
export const MAX_REPLICAS = 3;
export const DEFAULT_PARAMETERS: StorageClassParameters = {
  number_of_replicas: 1,
  data_locality: 'best-effort',
  fs_type: 'ext4',
  disk_selector: null,
  node_selector: null,
};

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
const DATA_LOCALITIES: readonly StorageClassDataLocality[] = [
  'disabled',
  'best-effort',
  'strict-local',
];
const FS_TYPES: readonly StorageClassFsType[] = ['ext4', 'xfs'];
// Longhorn tags; the selector parameter joins them with commas.
const TAG = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const MAX_TAGS = 10;

const PARAMETER_KEYS: readonly (keyof StorageClassParameters)[] = [
  'number_of_replicas',
  'data_locality',
  'fs_type',
  'disk_selector',
  'node_selector',
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

/** Tags from an array, or a comma-separated string; null when there are none. */
const normalizeTags = (value: unknown, label: string): string[] | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const items =
    typeof value === 'string'
      ? value.split(',')
      : Array.isArray(value)
        ? (value as unknown[])
        : null;

  if (items === null) {
    throw new BadRequestException(`${label} must be a list of tags`);
  }

  const tags: string[] = [];

  for (const item of items) {
    const tag = typeof item === 'string' ? item.trim().toLowerCase() : '';

    if (!TAG.test(tag)) {
      throw new BadRequestException(
        `${label} tags are up to 63 lowercase letters, digits, '.', '-' or '_'`,
      );
    }

    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  if (tags.length > MAX_TAGS) {
    throw new BadRequestException(`${label} takes at most ${MAX_TAGS} tags`);
  }

  return tags.length > 0 ? tags : null;
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

  const replicas =
    value.number_of_replicas ?? DEFAULT_PARAMETERS.number_of_replicas;

  if (
    typeof replicas !== 'number' ||
    !Number.isInteger(replicas) ||
    replicas < 1 ||
    replicas > MAX_REPLICAS
  ) {
    throw new BadRequestException(
      `Copies must be a whole number from 1 to ${MAX_REPLICAS}`,
    );
  }

  const dataLocality = normalizeEnum(
    value.data_locality,
    DATA_LOCALITIES,
    DEFAULT_PARAMETERS.data_locality,
    'Data locality',
  );

  // Longhorn keeps a strict-local volume on the pod's own server only.
  if (dataLocality === 'strict-local' && replicas !== 1) {
    throw new BadRequestException(
      "A copy kept strictly on the service's server allows only one copy",
    );
  }

  return {
    number_of_replicas: replicas,
    data_locality: dataLocality,
    fs_type: normalizeEnum(
      value.fs_type,
      FS_TYPES,
      DEFAULT_PARAMETERS.fs_type,
      'File system',
    ),
    disk_selector: normalizeTags(value.disk_selector, 'Disk selector'),
    node_selector: normalizeTags(value.node_selector, 'Node selector'),
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
