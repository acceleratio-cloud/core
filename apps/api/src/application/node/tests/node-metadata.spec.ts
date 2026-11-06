import { BadRequestException } from '@nestjs/common';
import {
  isReservedKey,
  normalizeNodeSelector,
  normalizeLabels,
  normalizeTaints,
} from '../node-metadata';

describe('node metadata', () => {
  it('accepts valid labels', () => {
    expect(
      normalizeLabels({ labels: { 'acceleratio.io/pool': 'gpu', tier: '' } }),
    ).toEqual({ 'acceleratio.io/pool': 'gpu', tier: '' });
  });

  it('rejects reserved and malformed label keys', () => {
    expect(() =>
      normalizeLabels({ labels: { 'node-role.kubernetes.io/worker': 'x' } }),
    ).toThrow(BadRequestException);
    expect(() => normalizeLabels({ labels: { 'bad key': 'x' } })).toThrow(
      BadRequestException,
    );
    expect(() => normalizeLabels({ labels: { a: 'x'.repeat(64) } })).toThrow(
      BadRequestException,
    );
  });

  it('normalizes taints and rejects duplicates or bad effects', () => {
    expect(
      normalizeTaints({
        taints: [{ key: 'dedicated', value: 'db', effect: 'NoSchedule' }],
      }),
    ).toEqual([{ key: 'dedicated', value: 'db', effect: 'NoSchedule' }]);
    expect(() =>
      normalizeTaints({
        taints: [
          { key: 'a', value: null, effect: 'NoSchedule' },
          { key: 'a', value: null, effect: 'NoSchedule' },
        ],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeTaints({
        taints: [{ key: 'a', value: null, effect: 'Bogus' as never }],
      }),
    ).toThrow(BadRequestException);
  });

  it('flags cluster-owned keys', () => {
    expect(isReservedKey('kubernetes.io/hostname')).toBe(true);
    expect(isReservedKey('acceleratio.io/pool')).toBe(false);
  });
});

describe('normalizeNodeSelector', () => {
  it('allows cluster-owned keys and omits an empty selector', () => {
    expect(normalizeNodeSelector({ 'kubernetes.io/hostname': 'n1' })).toEqual({
      'kubernetes.io/hostname': 'n1',
    });
    expect(normalizeNodeSelector({})).toBeUndefined();
    expect(normalizeNodeSelector(undefined)).toBeUndefined();
  });

  it('rejects invalid selectors', () => {
    expect(() => normalizeNodeSelector([])).toThrow(BadRequestException);
    expect(() => normalizeNodeSelector({ 'bad key': 'x' })).toThrow(
      BadRequestException,
    );
  });
});
