import type { V1StorageClass } from '@kubernetes/client-node';
import type { StorageClassParameters } from '@acceleratio/shared';
import { DEFAULT_REPLICATION } from './storage-class.config';

export const SEAWEEDFS_PROVISIONER = 'seaweedfs-csi-driver';
export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY_VALUE = 'acceleratio';
export const STORAGE_CLASS_ID_LABEL = 'acceleratio.io/storage-class-id';
export const DEFAULT_CLASS_ANNOTATION =
  'storageclass.kubernetes.io/is-default-class';

/**
 * Console field to SeaweedFS CSI parameter key. The driver turns these into
 * `weed mount` flags (pkg/driver/mounter.go). Only keys listed here are ever
 * written to a StorageClass.
 */
const DRIVER_KEYS = {
  replication: 'replication',
  disk_type: 'diskType',
  collection: 'collection',
  ttl: 'ttl',
  cache_capacity_mb: 'cacheCapacityMB',
  concurrent_writers: 'concurrentWriters',
  chunk_size_limit_mb: 'chunkSizeLimitMB',
  writeback_cache: 'writebackCache',
} as const satisfies Record<keyof StorageClassParameters, string>;

const INTEGER_FIELDS = [
  'cache_capacity_mb',
  'concurrent_writers',
  'chunk_size_limit_mb',
] as const;

export const toDriverParameters = (
  parameters: StorageClassParameters,
): Record<string, string> => {
  const result: Record<string, string> = {
    [DRIVER_KEYS.replication]: parameters.replication,
  };

  for (const field of ['disk_type', 'collection', 'ttl'] as const) {
    const value = parameters[field];

    if (value) {
      result[DRIVER_KEYS[field]] = value;
    }
  }

  for (const field of INTEGER_FIELDS) {
    const value = parameters[field];

    if (value !== null) {
      result[DRIVER_KEYS[field]] = String(value);
    }
  }

  if (parameters.writeback_cache) {
    result[DRIVER_KEYS.writeback_cache] = 'true';
  }

  return result;
};

const toInteger = (value: string | undefined): number | null => {
  if (value === undefined || !/^[0-9]+$/.test(value)) {
    return null;
  }

  return Number(value);
};

/**
 * Reads driver parameters of a live StorageClass (the platform class, which
 * the installer writes) into console fields. Keys the console does not model
 * are returned separately so they are shown instead of dropped.
 */
export const fromDriverParameters = (
  raw: Record<string, string> | undefined,
): { parameters: StorageClassParameters; extra: Record<string, string> } => {
  const source = raw ?? {};
  const known = new Set<string>(Object.values(DRIVER_KEYS));
  const extra: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key)) {
      extra[key] = value;
    }
  }

  return {
    parameters: {
      replication: source[DRIVER_KEYS.replication] || DEFAULT_REPLICATION,
      disk_type: source[DRIVER_KEYS.disk_type] || null,
      collection: source[DRIVER_KEYS.collection] || null,
      ttl: source[DRIVER_KEYS.ttl] || null,
      cache_capacity_mb: toInteger(source[DRIVER_KEYS.cache_capacity_mb]),
      concurrent_writers: toInteger(source[DRIVER_KEYS.concurrent_writers]),
      chunk_size_limit_mb: toInteger(source[DRIVER_KEYS.chunk_size_limit_mb]),
      writeback_cache: source[DRIVER_KEYS.writeback_cache] === 'true',
    },
    extra,
  };
};

export interface StorageClassManifestInput {
  id: string;
  external_name: string;
  parameters: StorageClassParameters;
  reclaim_policy: 'Delete' | 'Retain';
  volume_binding_mode: 'Immediate' | 'WaitForFirstConsumer';
  allow_volume_expansion: boolean;
}

export const buildStorageClass = (
  input: StorageClassManifestInput,
): V1StorageClass => ({
  apiVersion: 'storage.k8s.io/v1',
  kind: 'StorageClass',
  metadata: {
    name: input.external_name,
    labels: {
      [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      [STORAGE_CLASS_ID_LABEL]: input.id,
    },
    // Custom classes are never the cluster default; the platform class is.
    annotations: { [DEFAULT_CLASS_ANNOTATION]: 'false' },
  },
  provisioner: SEAWEEDFS_PROVISIONER,
  parameters: toDriverParameters(input.parameters),
  reclaimPolicy: input.reclaim_policy,
  volumeBindingMode: input.volume_binding_mode,
  allowVolumeExpansion: input.allow_volume_expansion,
});

export const isManagedStorageClass = (
  object: V1StorageClass,
  id: string,
): boolean =>
  object.metadata?.labels?.[MANAGED_BY_LABEL] === MANAGED_BY_VALUE &&
  object.metadata?.labels?.[STORAGE_CLASS_ID_LABEL] === id;
