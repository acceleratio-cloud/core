import type { StorageClassParameters } from '@acceleratio/shared';
import {
  buildStorageClass,
  fromDriverParameters,
  isManagedStorageClass,
  toDriverParameters,
} from '../storage-class.manifests';
import {
  deriveCustomClusterStatus,
  derivePlatformClusterStatus,
} from '../storage-class.status';

const id = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const baseParameters: StorageClassParameters = {
  number_of_replicas: 1,
  data_locality: 'best-effort',
  fs_type: 'ext4',
  disk_selector: null,
  node_selector: null,
};

const input = {
  id,
  external_name: 'sc-fast-7c1d2e3f',
  parameters: baseParameters,
  reclaim_policy: 'Delete' as const,
  volume_binding_mode: 'Immediate' as const,
  allow_volume_expansion: true,
};

describe('toDriverParameters', () => {
  it('writes copies, locality and file system, and selectors only when set', () => {
    expect(toDriverParameters(baseParameters)).toEqual({
      numberOfReplicas: '1',
      dataLocality: 'best-effort',
      fsType: 'ext4',
    });
  });

  it('joins selector tags with commas', () => {
    expect(
      toDriverParameters({
        number_of_replicas: 2,
        data_locality: 'disabled',
        fs_type: 'xfs',
        disk_selector: ['ssd', 'fast'],
        node_selector: ['zone-a'],
      }),
    ).toEqual({
      numberOfReplicas: '2',
      dataLocality: 'disabled',
      fsType: 'xfs',
      diskSelector: 'ssd,fast',
      nodeSelector: 'zone-a',
    });
  });

  it('round-trips through fromDriverParameters and keeps unknown keys apart', () => {
    const driver = {
      ...toDriverParameters({ ...baseParameters, disk_selector: ['hdd'] }),
      staleReplicaTimeout: '30',
    };

    expect(fromDriverParameters(driver)).toEqual({
      parameters: { ...baseParameters, disk_selector: ['hdd'] },
      extra: { staleReplicaTimeout: '30' },
    });
    expect(fromDriverParameters(undefined).parameters).toEqual({
      ...baseParameters,
      data_locality: 'disabled',
    });
  });
});

describe('buildStorageClass', () => {
  it('builds a labeled, non-default Longhorn class', () => {
    expect(buildStorageClass(input)).toEqual({
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: {
        name: 'sc-fast-7c1d2e3f',
        labels: {
          'app.kubernetes.io/managed-by': 'acceleratio',
          'acceleratio.io/storage-class-id': id,
        },
        annotations: { 'storageclass.kubernetes.io/is-default-class': 'false' },
      },
      provisioner: 'driver.longhorn.io',
      parameters: {
        numberOfReplicas: '1',
        dataLocality: 'best-effort',
        fsType: 'ext4',
      },
      reclaimPolicy: 'Delete',
      volumeBindingMode: 'Immediate',
      allowVolumeExpansion: true,
    });
  });

  it('recognizes only its own objects as managed', () => {
    const object = buildStorageClass(input);

    expect(isManagedStorageClass(object, id)).toBe(true);
    expect(isManagedStorageClass(object, 'other-id')).toBe(false);
    expect(
      isManagedStorageClass(
        { metadata: { name: 'x' }, provisioner: 'driver.longhorn.io' },
        id,
      ),
    ).toBe(false);
  });
});

describe('cluster status', () => {
  it('derives custom class status', () => {
    const live = buildStorageClass(input);

    expect(deriveCustomClusterStatus(input, undefined)).toBe('unknown');
    expect(deriveCustomClusterStatus(input, null)).toBe('missing');
    expect(deriveCustomClusterStatus(input, live)).toBe('ready');
    expect(
      deriveCustomClusterStatus(input, {
        ...live,
        parameters: { numberOfReplicas: '2' },
      }),
    ).toBe('drifted');
    expect(
      deriveCustomClusterStatus(input, {
        ...live,
        allowVolumeExpansion: false,
      }),
    ).toBe('drifted');
    expect(
      deriveCustomClusterStatus(input, { ...live, metadata: { name: 'x' } }),
    ).toBe('drifted');
  });

  it('derives platform class status', () => {
    expect(derivePlatformClusterStatus(undefined)).toBe('unknown');
    expect(derivePlatformClusterStatus(null)).toBe('missing');
    expect(derivePlatformClusterStatus({ provisioner: 'x' })).toBe('ready');
  });
});
