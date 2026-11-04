import type {
  CreateStorageClassPayload,
  StorageBenchmarkResults,
  StorageClass,
  StorageClassClusterStatus,
  StorageClassReclaimPolicy,
  StorageClassVolumeBindingMode,
} from '@acceleratio/shared';

/**
 * The console calls SeaweedFS StorageClasses "storage profiles" and speaks in
 * outcomes (copies, disk, what happens on delete, expiry). Driver terms stay
 * in the Advanced section.
 */

/** create: new profile; duplicate: new profile from another; edit/view: existing. */
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
export const REPLICATION_PATTERN = /^[0-9]{3}$/;
export const INTEGER_LIMITS = {
  cache_capacity_mb: { min: 0, max: 1_048_576 },
  concurrent_writers: { min: 1, max: 1024 },
  chunk_size_limit_mb: { min: 1, max: 1024 },
} as const;

/** Select value for "type my own" in the disk and expiry pickers. */
export const CUSTOM_CHOICE = '__custom';

export type Choice = { value: string; label: string; hint?: string };

export const COPY_CHOICES: Choice[] = [
  {
    value: '000',
    label: '1 copy',
    hint: 'Fastest and uses the least disk. Data is lost if its server fails.',
  },
  {
    value: '001',
    label: '2 copies on different servers',
    hint: 'Survives one server failure. Writes are slower and use 2× disk.',
  },
  {
    value: '002',
    label: '3 copies on different servers',
    hint: 'Survives two server failures. Writes are slowest and use 3× disk.',
  },
];

export const DISK_CHOICES: Choice[] = [
  { value: '', label: 'Any disk' },
  { value: 'ssd', label: 'SSD' },
  { value: 'hdd', label: 'HDD' },
  { value: CUSTOM_CHOICE, label: 'Custom disk tag' },
];

export const EXPIRY_CHOICES: Choice[] = [
  { value: '', label: 'Never' },
  { value: '1d', label: 'After 1 day' },
  { value: '7d', label: 'After 7 days' },
  { value: '30d', label: 'After 30 days' },
  { value: CUSTOM_CHOICE, label: 'Custom period' },
];

export const RECLAIM_CHOICES: Choice[] = [
  { value: 'Delete', label: 'Delete its data' },
  { value: 'Retain', label: 'Keep its data' },
];

export const BINDING_CHOICES: Choice[] = [
  { value: 'Immediate', label: 'As soon as the volume is requested' },
  {
    value: 'WaitForFirstConsumer',
    label: 'When the first app starts using it',
  },
];

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

export type StoragePreset = {
  id: string;
  title: string;
  summary: string;
  useFor: string;
  /** Volume servers the preset needs; null when any cluster can use it. */
  minServers: number | null;
  form: Partial<StorageClassForm>;
};

export const STORAGE_PRESETS: StoragePreset[] = [
  {
    id: 'fast',
    title: 'Fast, single copy',
    summary: 'Fastest writes. Data is lost if its server fails.',
    useFor: 'Caches, CI runners, development databases',
    minServers: null,
    form: {
      name: 'Fast',
      description: 'Fast single-copy storage for data that can be rebuilt.',
      replication: '000',
      concurrent_writers: '64',
    },
  },
  {
    id: 'durable',
    title: 'Durable, 2 copies',
    summary: 'Survives one server failure. Slower writes, 2× disk use.',
    useFor: 'Production databases, user uploads',
    minServers: 2,
    form: {
      name: 'Durable',
      description: 'Two copies on different servers for data that matters.',
      replication: '001',
      reclaim_policy: 'Retain',
    },
  },
  {
    id: 'archive',
    title: 'Archive, cheap disks',
    summary: 'HDD tier. Keeps data after its volume is deleted.',
    useFor: 'Backups, media, logs you keep',
    minServers: null,
    form: {
      name: 'Archive',
      description: 'Large, rarely read data on cheaper disks.',
      disk_type: 'hdd',
      reclaim_policy: 'Retain',
      chunk_size_limit_mb: '8',
    },
  },
  {
    id: 'temporary',
    title: 'Temporary, auto-expiry',
    summary: 'Data is deleted automatically after 7 days.',
    useFor: 'Scratch space, build caches, temporary exports',
    minServers: null,
    form: {
      name: 'Temporary',
      description: 'Scratch storage whose data expires after 7 days.',
      ttl: '7d',
    },
  },
  {
    id: 'custom',
    title: 'Custom',
    summary: 'Start from the defaults and choose every setting.',
    useFor: 'Anything the presets do not cover',
    minServers: null,
    form: {},
  },
];

export const presetForm = (preset: StoragePreset): StorageClassForm => ({
  ...EMPTY_FORM,
  ...preset.form,
});

/** Copies a SeaweedFS replication code `xyz` needs: 1 + x + y + z. */
export const replicationCopies = (replication: string) =>
  REPLICATION_PATTERN.test(replication)
    ? 1 + Array.from(replication).reduce((sum, digit) => sum + Number(digit), 0)
    : 1;

/** Select value for a stored choice, or CUSTOM_CHOICE when it is not listed. */
export const choiceValue = (choices: Choice[], value: string) =>
  choices.some((choice) => choice.value === value && value !== CUSTOM_CHOICE)
    ? value
    : CUSTOM_CHOICE;

const ttlLabel = (ttl: string) => {
  const match = /^([0-9]+)([mhdwMy])$/.exec(ttl);

  if (!match) {
    return ttl;
  }

  const units: Record<string, string> = {
    m: 'minute',
    h: 'hour',
    d: 'day',
    w: 'week',
    M: 'month',
    y: 'year',
  };
  const count = Number(match[1]);

  return `${count} ${units[match[2]]}${count === 1 ? '' : 's'}`;
};

export const copiesLabel = (replication: string) => {
  const copies = replicationCopies(replication);
  const listed = COPY_CHOICES.find((choice) => choice.value === replication);

  return listed?.label ?? `${copies} copies (code ${replication})`;
};

/** Short outcome tags for a profile row. */
export const profileSummary = (storageClass: StorageClass): string[] => {
  const parameters = storageClass.parameters;

  if (!parameters) {
    return ['Settings unavailable'];
  }

  const copies = replicationCopies(parameters.replication);
  const items = [copies === 1 ? '1 copy' : `${copies} copies`];

  items.push(
    parameters.disk_type ? parameters.disk_type.toUpperCase() : 'Any disk',
  );

  if (storageClass.reclaim_policy) {
    items.push(
      storageClass.reclaim_policy === 'Retain'
        ? 'Data kept after volume delete'
        : 'Data deleted with volume',
    );
  }

  if (parameters.ttl) {
    items.push(`Expires after ${ttlLabel(parameters.ttl)}`);
  }

  return items;
};

export type Outcome = { label: string; value: string };

/** What a profile means for the data, in plain terms. */
export const describeOutcomes = (form: StorageClassForm): Outcome[] => {
  const copies = replicationCopies(form.replication);
  const ttl = form.ttl.trim();

  return [
    {
      label: 'Durability',
      value:
        copies === 1
          ? 'Lost if its server fails'
          : `Survives ${copies - 1} server ${copies === 2 ? 'failure' : 'failures'}`,
    },
    {
      label: 'Disk use',
      value: copies === 1 ? 'Same as the data' : `${copies}× the data`,
    },
    {
      label: 'When a volume is deleted',
      value:
        form.reclaim_policy === 'Retain'
          ? 'Its data is kept on disk'
          : 'Its data is deleted',
    },
    {
      label: 'Expiry',
      value:
        ttl && TTL_PATTERN.test(ttl)
          ? `Data is deleted after ${ttlLabel(ttl)}`
          : 'Data is kept until deleted',
    },
  ];
};

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
    ready: 'Active',
    missing: 'Missing from cluster',
    drifted: 'Differs from cluster',
    unknown: 'Cluster unreachable',
  };

export const formatIops = (value: number) =>
  value >= 10_000
    ? `${Math.round(value / 1000)}k`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(value);

export const formatMbps = (value: number) =>
  value >= 100 ? String(Math.round(value)) : value.toFixed(1);

export const benchmarkHeadline = (results: StorageBenchmarkResults) =>
  `${formatIops(results.random_read_iops)} read / ${formatIops(results.random_write_iops)} write IOPS`;
