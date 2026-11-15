import type {
  CreateStorageClassPayload,
  StorageBenchmarkResults,
  StorageClass,
  StorageClassClusterStatus,
  StorageClassDataLocality,
  StorageClassFsType,
  StorageClassReclaimPolicy,
  StorageClassVolumeBindingMode,
} from '@acceleratio/shared';

/**
 * The console calls Longhorn StorageClasses "storage profiles" and speaks in
 * outcomes (copies, disk, placement, what happens on delete). Driver terms
 * stay in the Advanced section.
 */

/** create: new profile; duplicate: new profile from another; edit/view: existing. */
export type StorageClassDialogMode = 'create' | 'duplicate' | 'edit' | 'view';

export type StorageClassForm = {
  name: string;
  description: string;
  /** '1' to '3'. */
  number_of_replicas: string;
  data_locality: StorageClassDataLocality;
  fs_type: StorageClassFsType;
  /** Comma-separated Longhorn disk tags; empty for any disk. */
  disk_selector: string;
  /** Comma-separated Longhorn node tags; empty for any server. */
  node_selector: string;
  reclaim_policy: StorageClassReclaimPolicy;
  volume_binding_mode: StorageClassVolumeBindingMode;
  allow_volume_expansion: boolean;
};

// Mirrors apps/api storage-class.config.ts; the API stays the authority.
export const NAME_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 1000;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/** Select value for "type my own" in the disk picker. */
export const CUSTOM_CHOICE = '__custom';

export type Choice = { value: string; label: string; hint?: string };

export const COPY_CHOICES: Choice[] = [
  {
    value: '1',
    label: '1 copy',
    hint: 'Fastest and uses the least disk. Data is lost if its server fails.',
  },
  {
    value: '2',
    label: '2 copies on different servers',
    hint: 'Survives one server failure. Every write waits for the network, so it is slower and uses 2× disk.',
  },
  {
    value: '3',
    label: '3 copies on different servers',
    hint: 'Survives two server failures. Slowest writes and 3× disk.',
  },
];

export const DISK_CHOICES: Choice[] = [
  { value: '', label: 'Any disk' },
  { value: 'ssd', label: 'SSD' },
  { value: 'hdd', label: 'HDD' },
  { value: CUSTOM_CHOICE, label: 'Custom disk tags' },
];

export const LOCALITY_CHOICES: Choice[] = [
  {
    value: 'best-effort',
    label: 'Keep a copy next to the service when possible',
    hint: 'Reads stay on the service’s own server while it can.',
  },
  {
    value: 'disabled',
    label: 'Place copies on any server',
    hint: 'Copies stay where they are when the service moves.',
  },
  {
    value: 'strict-local',
    label: 'Always one copy on the service’s server',
    hint: 'Fastest, but one copy only, and the service cannot move to another server.',
  },
];

export const FS_CHOICES: Choice[] = [
  { value: 'ext4', label: 'ext4' },
  { value: 'xfs', label: 'XFS' },
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
  number_of_replicas: '1',
  data_locality: 'best-effort',
  fs_type: 'ext4',
  disk_selector: '',
  node_selector: '',
  reclaim_policy: 'Delete',
  volume_binding_mode: 'Immediate',
  allow_volume_expansion: true,
};

export type StoragePreset = {
  id: string;
  title: string;
  summary: string;
  useFor: string;
  /** Storage servers the preset needs; null when any cluster can use it. */
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
      number_of_replicas: '1',
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
      number_of_replicas: '2',
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
      disk_selector: 'hdd',
      reclaim_policy: 'Retain',
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

/** Copies a form asks for; 1 until it holds a number. */
export const formCopies = (
  form: Pick<StorageClassForm, 'number_of_replicas'>,
) => Number.parseInt(form.number_of_replicas, 10) || 1;

/** Select value for a stored choice, or CUSTOM_CHOICE when it is not listed. */
export const choiceValue = (choices: Choice[], value: string) =>
  choices.some((choice) => choice.value === value && value !== CUSTOM_CHOICE)
    ? value
    : CUSTOM_CHOICE;

const tagList = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

/** react-hook-form `validate` for a comma-separated list of tags. */
export const validateTags = (value: string) =>
  tagList(value).every((tag) => TAG_PATTERN.test(tag)) ||
  'Use tags of lowercase letters, digits, ., - or _, separated by commas.';

/** Short outcome tags for a profile row. */
export const profileSummary = (storageClass: StorageClass): string[] => {
  const parameters = storageClass.parameters;

  if (!parameters) {
    return ['Settings unavailable'];
  }

  const copies = parameters.number_of_replicas;
  const items = [copies === 1 ? '1 copy' : `${copies} copies`];

  items.push(
    parameters.disk_selector
      ? parameters.disk_selector.join(', ').toUpperCase()
      : 'Any disk',
  );

  if (storageClass.reclaim_policy) {
    items.push(
      storageClass.reclaim_policy === 'Retain'
        ? 'Data kept after volume delete'
        : 'Data deleted with volume',
    );
  }

  return items;
};

export type Outcome = { label: string; value: string };

/** What a profile means for the data, in plain terms. */
export const describeOutcomes = (form: StorageClassForm): Outcome[] => {
  const copies = formCopies(form);

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
      label: 'Placement',
      value:
        LOCALITY_CHOICES.find((choice) => choice.value === form.data_locality)
          ?.label ?? form.data_locality,
    },
  ];
};

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
    number_of_replicas: String(
      parameters?.number_of_replicas ?? EMPTY_FORM.number_of_replicas,
    ),
    data_locality: parameters?.data_locality ?? EMPTY_FORM.data_locality,
    fs_type: parameters?.fs_type ?? EMPTY_FORM.fs_type,
    disk_selector: parameters?.disk_selector?.join(', ') ?? '',
    node_selector: parameters?.node_selector?.join(', ') ?? '',
    reclaim_policy: storageClass.reclaim_policy ?? EMPTY_FORM.reclaim_policy,
    volume_binding_mode:
      storageClass.volume_binding_mode ?? EMPTY_FORM.volume_binding_mode,
    allow_volume_expansion: storageClass.allow_volume_expansion,
  };
};

const toOptional = (value: string) => value.trim() || null;

const toTags = (value: string) => {
  const tags = tagList(value);

  return tags.length > 0 ? tags : null;
};

export const toCreatePayload = (
  form: StorageClassForm,
): CreateStorageClassPayload => ({
  name: form.name.trim(),
  description: toOptional(form.description),
  parameters: {
    number_of_replicas: formCopies(form),
    data_locality: form.data_locality,
    fs_type: form.fs_type,
    disk_selector: toTags(form.disk_selector),
    node_selector: toTags(form.node_selector),
  },
  reclaim_policy: form.reclaim_policy,
  volume_binding_mode: form.volume_binding_mode,
  allow_volume_expansion: form.allow_volume_expansion,
});

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

/** "1m 10s", "45s"; null until the run has both timestamps. */
export const formatDuration = (
  startedAt: string | null,
  finishedAt: string | null,
) => {
  if (!startedAt || !finishedAt) {
    return null;
  }

  const seconds = Math.max(
    0,
    Math.round(
      (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    ),
  );
  const minutes = Math.floor(seconds / 60);

  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
};

/** Signed percent change, such as "+12%"; null when there is no baseline. */
export const formatChange = (current: number, previous: number | undefined) => {
  if (previous === undefined || previous <= 0) {
    return null;
  }

  const change = Math.round(((current - previous) / previous) * 100);

  return change === 0 ? '±0%' : `${change > 0 ? '+' : ''}${change}%`;
};
