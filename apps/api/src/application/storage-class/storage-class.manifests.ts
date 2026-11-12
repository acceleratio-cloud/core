import type { V1StorageClass } from '@kubernetes/client-node';
import type {
  StorageClassDataLocality,
  StorageClassFsType,
  StorageClassParameters,
} from '@acceleratio/shared';
import { DEFAULT_PARAMETERS } from './storage-class.config';

export const LONGHORN_PROVISIONER = 'driver.longhorn.io';
export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY_VALUE = 'acceleratio';
export const STORAGE_CLASS_ID_LABEL = 'acceleratio.io/storage-class-id';
export const DEFAULT_CLASS_ANNOTATION =
  'storageclass.kubernetes.io/is-default-class';

/**
 * Console field to Longhorn StorageClass parameter. Only keys listed here are
 * ever written to a StorageClass.
 */
const DRIVER_KEYS = {
  number_of_replicas: 'numberOfReplicas',
  data_locality: 'dataLocality',
  fs_type: 'fsType',
  disk_selector: 'diskSelector',
  node_selector: 'nodeSelector',
} as const satisfies Record<keyof StorageClassParameters, string>;

export const toDriverParameters = (
  parameters: StorageClassParameters,
): Record<string, string> => ({
  [DRIVER_KEYS.number_of_replicas]: String(parameters.number_of_replicas),
  [DRIVER_KEYS.data_locality]: parameters.data_locality,
  [DRIVER_KEYS.fs_type]: parameters.fs_type,
  ...(parameters.disk_selector
    ? { [DRIVER_KEYS.disk_selector]: parameters.disk_selector.join(',') }
    : {}),
  ...(parameters.node_selector
    ? { [DRIVER_KEYS.node_selector]: parameters.node_selector.join(',') }
    : {}),
});

const tags = (value: string | undefined): string[] | null => {
  const list = (value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  return list.length > 0 ? list : null;
};

/**
 * Reads the parameters of a live StorageClass (the platform class, which the
 * installer writes) into console fields. Keys the console does not model are
 * returned separately so they are shown instead of dropped.
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

  const replicas = Number(source[DRIVER_KEYS.number_of_replicas]);

  return {
    parameters: {
      number_of_replicas:
        Number.isInteger(replicas) && replicas > 0
          ? replicas
          : DEFAULT_PARAMETERS.number_of_replicas,
      data_locality:
        (source[DRIVER_KEYS.data_locality] as StorageClassDataLocality) ||
        'disabled',
      fs_type:
        (source[DRIVER_KEYS.fs_type] as StorageClassFsType) ||
        DEFAULT_PARAMETERS.fs_type,
      disk_selector: tags(source[DRIVER_KEYS.disk_selector]),
      node_selector: tags(source[DRIVER_KEYS.node_selector]),
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
  provisioner: LONGHORN_PROVISIONER,
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
