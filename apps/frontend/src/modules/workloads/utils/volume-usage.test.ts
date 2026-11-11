import { describe, expect, it } from 'bun:test';

import type { Workload } from '@acceleratio/shared';

import {
  isUsageStale,
  projectHasDisks,
  serviceVolumeFills,
  VOLUME_USAGE_MAX_AGE_MS,
  volumeFill,
} from './volume-usage';

const GiB = 1024 ** 3;

describe('volumeFill', () => {
  it('is null until usage is reported', () => {
    expect(volumeFill(1, undefined)).toBeNull();
  });

  it('flags a volume from 85% and marks it critical from 95%', () => {
    const at = (used: number) =>
      volumeFill(1, {
        id: 'v',
        used_bytes: used,
        capacity_bytes: 1000,
      })?.level;

    expect(at(849)).toBe('ok');
    expect(at(850)).toBe('warning');
    expect(at(950)).toBe('critical');
  });

  it('falls back to the configured size and caps the ratio at 1', () => {
    const fill = volumeFill(1, {
      id: 'v',
      used_bytes: 2 * GiB,
      capacity_bytes: null,
    });

    expect(fill).toMatchObject({
      capacityBytes: GiB,
      ratio: 1,
      level: 'critical',
    });
  });
});

const service = (
  draft: { id: string; size_gb: number }[] | null,
  active: { id: string; size_gb: number }[] | null,
) =>
  ({
    type: 'docker',
    draft_config: draft && {
      volumes: draft.map((v) => ({
        ...v,
        mount_path: `/${v.id}`,
        storage_class_id: null,
      })),
    },
    active_version: active && {
      config: {
        volumes: active.map((v) => ({
          ...v,
          mount_path: `/${v.id}`,
          storage_class_id: null,
        })),
      },
    },
  }) as unknown as Workload;
const usage = (entries: [string, number][]) =>
  new Map(
    entries.map(([id, used]) => [
      id,
      { id, used_bytes: used * GiB, capacity_bytes: GiB },
    ]),
  );

describe('serviceVolumeFills', () => {
  it('still warns about a full volume the draft removes', () => {
    const { items, full } = serviceVolumeFills(
      service(
        [{ id: 'a', size_gb: 1 }],
        [
          { id: 'a', size_gb: 1 },
          { id: 'b', size_gb: 1 },
        ],
      ),
      usage([
        ['a', 0.5],
        ['b', 0.9],
      ]),
    );

    expect(items.map(({ volume }) => volume.id)).toEqual(['a']);
    expect(full.map(({ volume, removed }) => [volume.id, removed])).toEqual([
      ['b', true],
    ]);
  });

  it('orders full volumes fullest first', () => {
    const { full } = serviceVolumeFills(
      service(null, [
        { id: 'a', size_gb: 1 },
        { id: 'b', size_gb: 1 },
      ]),
      usage([
        ['a', 0.86],
        ['b', 0.97],
      ]),
    );

    expect(full.map(({ volume }) => volume.id)).toEqual(['b', 'a']);
  });
});

describe('projectHasDisks', () => {
  it('is true for a database or a service with volumes, false otherwise', () => {
    expect(projectHasDisks([{ type: 'postgres' } as Workload])).toBe(true);
    expect(projectHasDisks([service(null, [{ id: 'a', size_gb: 1 }])])).toBe(
      true,
    );
    expect(projectHasDisks([service(null, [])])).toBe(false);
  });
});

describe('isUsageStale', () => {
  it('drops a reading older than three minutes, or none at all', () => {
    expect(isUsageStale(0, Date.now())).toBe(true);
    expect(isUsageStale(1_000, 1_000 + VOLUME_USAGE_MAX_AGE_MS)).toBe(false);
    expect(isUsageStale(1_000, 1_001 + VOLUME_USAGE_MAX_AGE_MS)).toBe(true);
  });
});
