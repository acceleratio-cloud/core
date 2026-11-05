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
  replication: '000',
  disk_type: null,
  collection: null,
  ttl: null,
  cache_capacity_mb: null,
  concurrent_writers: null,
  chunk_size_limit_mb: null,
  writeback_cache: false,
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
  it('writes only replication for defaults', () => {
    expect(toDriverParameters(baseParameters)).toEqual({ replication: '000' });
  });

  it('maps every field to its driver key', () => {
    expect(
      toDriverParameters({
        replication: '001',
        disk_type: 'ssd',
        collection: 'db',
        ttl: '1w',
        cache_capacity_mb: 0,
        concurrent_writers: 32,
        chunk_size_limit_mb: 4,
        writeback_cache: true,
      }),
    ).toEqual({
      replication: '001',
      diskType: 'ssd',
      collection: 'db',
      ttl: '1w',
      cacheCapacityMB: '0',
      concurrentWriters: '32',
      chunkSizeLimitMB: '4',
      writebackCache: 'true',
    });
  });

  it('round-trips through fromDriverParameters and keeps unknown keys apart', () => {
    const driver = {
      ...toDriverParameters({ ...baseParameters, disk_type: 'hdd' }),
      dataLocality: 'none',
    };

    expect(fromDriverParameters(driver)).toEqual({
      parameters: { ...baseParameters, disk_type: 'hdd' },
      extra: { dataLocality: 'none' },
    });
    expect(fromDriverParameters(undefined).parameters).toEqual(baseParameters);
  });
});

describe('buildStorageClass', () => {
  it('builds a labeled, non-default SeaweedFS class', () => {
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
      provisioner: 'seaweedfs-csi-driver',
      parameters: { replication: '000' },
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
        { metadata: { name: 'x' }, provisioner: 'seaweedfs-csi-driver' },
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
        parameters: { replication: '001' },
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
