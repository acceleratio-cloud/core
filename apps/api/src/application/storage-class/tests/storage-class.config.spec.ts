import { BadRequestException } from '@nestjs/common';
import type { CreateStorageClassPayload } from '@acceleratio/shared';
import {
  LOCKED_SETTINGS_MESSAGE,
  normalizeCreatePayload,
  normalizeParameters,
  normalizeUpdatePayload,
  replicationCopies,
} from '../storage-class.config';

const asPayload = (value: unknown) => value as CreateStorageClassPayload;

describe('normalizeCreatePayload', () => {
  it('fills defaults for a name-only payload', () => {
    expect(normalizeCreatePayload({ name: '  Fast scratch ' })).toEqual({
      name: 'Fast scratch',
      description: null,
      parameters: {
        replication: '000',
        disk_type: null,
        collection: null,
        ttl: null,
        cache_capacity_mb: null,
        concurrent_writers: null,
        chunk_size_limit_mb: null,
        writeback_cache: false,
      },
      reclaim_policy: 'Delete',
      volume_binding_mode: 'Immediate',
      allow_volume_expansion: true,
    });
  });

  it('keeps valid settings', () => {
    const result = normalizeCreatePayload({
      name: 'SSD',
      description: '  Databases  ',
      parameters: {
        replication: '001',
        disk_type: 'ssd',
        collection: 'db_data',
        ttl: '7d',
        cache_capacity_mb: 0,
        concurrent_writers: 64,
        chunk_size_limit_mb: 8,
        writeback_cache: true,
      },
      reclaim_policy: 'Retain',
      volume_binding_mode: 'WaitForFirstConsumer',
      allow_volume_expansion: false,
    });

    expect(result.description).toBe('Databases');
    expect(result.parameters).toEqual({
      replication: '001',
      disk_type: 'ssd',
      collection: 'db_data',
      ttl: '7d',
      cache_capacity_mb: 0,
      concurrent_writers: 64,
      chunk_size_limit_mb: 8,
      writeback_cache: true,
    });
    expect(result.reclaim_policy).toBe('Retain');
    expect(result.volume_binding_mode).toBe('WaitForFirstConsumer');
    expect(result.allow_volume_expansion).toBe(false);
  });

  it('treats empty optional strings as unset', () => {
    const result = normalizeParameters({ disk_type: '', ttl: '' });

    expect(result.disk_type).toBeNull();
    expect(result.ttl).toBeNull();
  });

  it.each([
    [{ replication: '1' }, 'Replication'],
    [{ replication: 'abc' }, 'Replication'],
    [{ disk_type: 'SSD' }, 'Disk type'],
    [{ collection: 'a b' }, 'Collection'],
    [{ ttl: '7 days' }, 'TTL'],
    [{ ttl: '0d' }, 'TTL'],
    [{ cache_capacity_mb: -1 }, 'Cache capacity'],
    [{ concurrent_writers: 0 }, 'Concurrent writers'],
    [{ chunk_size_limit_mb: 1.5 }, 'Chunk size limit'],
    [{ writeback_cache: 'yes' }, 'Write-back cache'],
    [{ dataCenter: 'dc1' }, 'Unknown storage parameter: dataCenter'],
  ])('rejects parameters %p', (parameters, message) => {
    expect(() =>
      normalizeCreatePayload(asPayload({ name: 'x', parameters })),
    ).toThrow(new RegExp(message));
  });

  it('rejects unknown fields, enums and a missing name', () => {
    expect(() =>
      normalizeCreatePayload(asPayload({ name: 'x', provisioner: 'other' })),
    ).toThrow('Unknown field: provisioner');
    expect(() =>
      normalizeCreatePayload(
        asPayload({ name: 'x', reclaim_policy: 'Recycle' }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeCreatePayload(
        asPayload({ name: 'x', volume_binding_mode: 'Later' }),
      ),
    ).toThrow(BadRequestException);
    expect(() => normalizeCreatePayload(asPayload({}))).toThrow(
      'Name is required',
    );
    expect(() => normalizeCreatePayload(undefined)).toThrow(
      'Request body must be an object',
    );
  });
});

describe('normalizeUpdatePayload', () => {
  it('accepts the editable fields only', () => {
    expect(
      normalizeUpdatePayload({
        name: ' Renamed ',
        description: '',
        allow_volume_expansion: false,
      }),
    ).toEqual({
      name: 'Renamed',
      description: null,
      allow_volume_expansion: false,
    });
    expect(normalizeUpdatePayload({})).toEqual({});
  });

  it.each(['parameters', 'reclaim_policy', 'volume_binding_mode'])(
    'refuses the locked setting %s',
    (key) => {
      expect(() => normalizeUpdatePayload({ [key]: 'x' })).toThrow(
        LOCKED_SETTINGS_MESSAGE,
      );
    },
  );

  it('refuses unknown fields', () => {
    expect(() => normalizeUpdatePayload({ kind: 'platform' } as never)).toThrow(
      'Unknown field: kind',
    );
  });
});

describe('replicationCopies', () => {
  it.each([
    ['000', 1],
    ['001', 2],
    ['010', 2],
    ['200', 3],
    ['111', 4],
  ])('%s needs %i copies', (code, copies) => {
    expect(replicationCopies(code)).toBe(copies);
  });
});
