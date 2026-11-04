import type { V1StorageClass } from '@kubernetes/client-node';
import type { StorageClassClusterStatus } from '@acceleratio/shared';
import {
  buildStorageClass,
  isManagedStorageClass,
  type StorageClassManifestInput,
} from './storage-class.manifests';

const sameParameters = (
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean => {
  const a = left ?? {};
  const b = right ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
};

/**
 * Compares a custom class's desired state with the live object. `live` is
 * null when the object is absent and undefined when the cluster could not be
 * listed.
 */
export const deriveCustomClusterStatus = (
  desired: StorageClassManifestInput,
  live: V1StorageClass | null | undefined,
): StorageClassClusterStatus => {
  if (live === undefined) {
    return 'unknown';
  }

  if (live === null) {
    return 'missing';
  }

  const expected = buildStorageClass(desired);

  if (
    !isManagedStorageClass(live, desired.id) ||
    live.provisioner !== expected.provisioner ||
    !sameParameters(live.parameters, expected.parameters) ||
    (live.reclaimPolicy ?? 'Delete') !== expected.reclaimPolicy ||
    (live.volumeBindingMode ?? 'Immediate') !== expected.volumeBindingMode ||
    (live.allowVolumeExpansion ?? false) !== expected.allowVolumeExpansion
  ) {
    return 'drifted';
  }

  return 'ready';
};

/** The platform class has no stored desired state: it exists or it does not. */
export const derivePlatformClusterStatus = (
  live: V1StorageClass | null | undefined,
): StorageClassClusterStatus => {
  if (live === undefined) {
    return 'unknown';
  }

  return live === null ? 'missing' : 'ready';
};
