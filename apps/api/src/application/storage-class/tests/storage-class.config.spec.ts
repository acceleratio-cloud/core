import { BadRequestException } from '@nestjs/common';
import type { CreateStorageClassPayload } from '@acceleratio/shared';
import {
  LOCKED_SETTINGS_MESSAGE,
  normalizeCreatePayload,
  normalizeParameters,
  normalizeUpdatePayload,
} from '../storage-class.config';

const asPayload = (value: unknown) => value as CreateStorageClassPayload;

describe('normalizeCreatePayload', () => {
  it('fills defaults for a name-only payload', () => {
    expect(normalizeCreatePayload({ name: '  Fast scratch ' })).toEqual({
      name: 'Fast scratch',
      description: null,
      parameters: {
        number_of_replicas: 1,
        data_locality: 'best-effort',
        fs_type: 'ext4',
        disk_selector: null,
        node_selector: null,
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
        number_of_replicas: 2,
        data_locality: 'disabled',
        fs_type: 'xfs',
        disk_selector: ['ssd', ' NVMe ', 'ssd'],
        node_selector: ['zone-a'],
      },
      reclaim_policy: 'Retain',
      volume_binding_mode: 'WaitForFirstConsumer',
      allow_volume_expansion: false,
    });

    expect(result.description).toBe('Databases');
    expect(result.parameters).toEqual({
      number_of_replicas: 2,
      data_locality: 'disabled',
      fs_type: 'xfs',
      disk_selector: ['ssd', 'nvme'],
      node_selector: ['zone-a'],
    });
    expect(result.reclaim_policy).toBe('Retain');
    expect(result.volume_binding_mode).toBe('WaitForFirstConsumer');
    expect(result.allow_volume_expansion).toBe(false);
  });

  it('reads tags from a comma-separated string and empty ones as unset', () => {
    const result = normalizeParameters({
      disk_selector: 'ssd, fast',
      node_selector: '',
    });

    expect(result.disk_selector).toEqual(['ssd', 'fast']);
    expect(result.node_selector).toBeNull();
  });

  it.each([
    [{ number_of_replicas: 0 }, 'Copies'],
    [{ number_of_replicas: 4 }, 'Copies'],
    [{ number_of_replicas: 1.5 }, 'Copies'],
    [{ data_locality: 'nearby' }, 'Data locality'],
    [{ number_of_replicas: 2, data_locality: 'strict-local' }, 'only one copy'],
    [{ fs_type: 'btrfs' }, 'File system'],
    [{ disk_selector: ['a b'] }, 'Disk selector'],
    [{ node_selector: 42 }, 'Node selector'],
    [{ replication: '001' }, 'Unknown storage parameter: replication'],
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
