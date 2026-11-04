import type {
  CreateStorageClassPayload,
  StorageClass,
  StorageClassClusterStatus,
  StorageClassReclaimPolicy,
  StorageClassVolumeBindingMode,
} from '@acceleratio/shared';

/** create: new class; duplicate: new class from another; edit/view: existing. */
export type StorageClassDialogMode = 'create' | 'duplicate' | 'edit' | 'view';

export type StorageClassForm = {
  name: string;
  description: string;
  replication: string;
  disk_type: string;
  collection: string;
  ttl: string;
  cache_capacity_mb: string;
  concurrent_writers: string;
  chunk_size_limit_mb: string;
  writeback_cache: boolean;
  reclaim_policy: StorageClassReclaimPolicy;
  volume_binding_mode: StorageClassVolumeBindingMode;
  allow_volume_expansion: boolean;
};

// Mirrors apps/api storage-class.config.ts; the API stays the authority.
export const NAME_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 1000;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const TTL_PATTERN = /^[1-9][0-9]{0,4}[mhdwMy]$/;
export const INTEGER_LIMITS = {
  cache_capacity_mb: { min: 0, max: 1_048_576 },
  concurrent_writers: { min: 1, max: 1024 },
  chunk_size_limit_mb: { min: 1, max: 1024 },
} as const;

export const REPLICATION_OPTIONS: { value: string; label: string }[] = [
  { value: '000', label: '000 · One copy, no replication' },
  { value: '001', label: '001 · Two copies on different servers' },
  { value: '002', label: '002 · Three copies on different servers' },
  { value: '010', label: '010 · Two copies on different racks' },
  { value: '100', label: '100 · Two copies in different data centers' },
  { value: '011', label: '011 · Three copies across servers and racks' },
];

export const DISK_TYPE_SUGGESTIONS = ['hdd', 'ssd'];

export const EMPTY_FORM: StorageClassForm = {
  name: '',
  description: '',
  replication: '000',
  disk_type: '',
  collection: '',
  ttl: '',
  cache_capacity_mb: '',
  concurrent_writers: '',
  chunk_size_limit_mb: '',
  writeback_cache: false,
  reclaim_policy: 'Delete',
  volume_binding_mode: 'Immediate',
  allow_volume_expansion: true,
};

/** Copies a SeaweedFS replication code `xyz` needs: 1 + x + y + z. */
export const replicationCopies = (replication: string) =>
  /^[0-9]{3}$/.test(replication)
    ? 1 + Array.from(replication).reduce((sum, digit) => sum + Number(digit), 0)
    : 1;

const toText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

export const toForm = (
  storageClass: StorageClass,
  mode: StorageClassDialogMode,
): StorageClassForm => {
  const parameters = storageClass.parameters;

  return {
    name:
      mode === 'duplicate'
        ? `${storageClass.name} copy`.slice(0, NAME_MAX_LENGTH)
        : storageClass.name,
    description: storageClass.description ?? '',
    replication: parameters?.replication ?? EMPTY_FORM.replication,
    disk_type: parameters?.disk_type ?? '',
    collection: parameters?.collection ?? '',
    ttl: parameters?.ttl ?? '',
    cache_capacity_mb: toText(parameters?.cache_capacity_mb),
    concurrent_writers: toText(parameters?.concurrent_writers),
    chunk_size_limit_mb: toText(parameters?.chunk_size_limit_mb),
    writeback_cache: parameters?.writeback_cache ?? false,
    reclaim_policy: storageClass.reclaim_policy ?? EMPTY_FORM.reclaim_policy,
    volume_binding_mode:
      storageClass.volume_binding_mode ?? EMPTY_FORM.volume_binding_mode,
    allow_volume_expansion: storageClass.allow_volume_expansion,
  };
};

const toInteger = (value: string) =>
  value.trim() === '' ? null : Number(value.trim());

const toOptional = (value: string) => value.trim() || null;

export const toCreatePayload = (
  form: StorageClassForm,
): CreateStorageClassPayload => ({
  name: form.name.trim(),
  description: toOptional(form.description),
  parameters: {
    replication: form.replication,
    disk_type: toOptional(form.disk_type),
    collection: toOptional(form.collection),
    ttl: toOptional(form.ttl),
    cache_capacity_mb: toInteger(form.cache_capacity_mb),
    concurrent_writers: toInteger(form.concurrent_writers),
    chunk_size_limit_mb: toInteger(form.chunk_size_limit_mb),
    writeback_cache: form.writeback_cache,
  },
  reclaim_policy: form.reclaim_policy,
  volume_binding_mode: form.volume_binding_mode,
  allow_volume_expansion: form.allow_volume_expansion,
});

/** react-hook-form `validate` for an optional whole number in a range. */
export const validateInteger =
  (limits: { min: number; max: number }) => (value: string) => {
    if (value.trim() === '') {
      return true;
    }

    const number = Number(value.trim());

    return (
      (Number.isInteger(number) &&
        number >= limits.min &&
        number <= limits.max) ||
      `Use a whole number from ${limits.min} to ${limits.max}.`
    );
  };

export const CLUSTER_STATUS_LABELS: Record<StorageClassClusterStatus, string> =
  {
    ready: 'In cluster',
    missing: 'Missing from cluster',
    drifted: 'Differs from cluster',
    unknown: 'Cluster unreachable',
  };

export const BINDING_MODE_LABELS: Record<
  StorageClassVolumeBindingMode,
  string
> = {
  Immediate: 'Immediate',
  WaitForFirstConsumer: 'Wait for first consumer',
};
