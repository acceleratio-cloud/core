import { describe, expect, it } from 'bun:test';

import {
  formatLabels,
  formatSelector,
  formatTaints,
  parseLabels,
  parseTaints,
} from '../utils/node-metadata';

describe('node metadata text', () => {
  it('round-trips labels and hides cluster-owned ones', () => {
    expect(formatLabels({ pool: 'gpu', 'kubernetes.io/hostname': 'n1' })).toBe(
      'pool=gpu',
    );
    expect(parseLabels('pool=gpu\n\n tier \n')).toEqual({
      pool: 'gpu',
      tier: '',
    });
  });

  it('keeps cluster-owned keys in a node selector', () => {
    expect(formatSelector({ 'kubernetes.io/hostname': 'n1' })).toBe(
      'kubernetes.io/hostname=n1',
    );
  });

  it('parses taints with and without a value', () => {
    expect(
      parseTaints('dedicated=db:NoSchedule\nspot:PreferNoSchedule'),
    ).toEqual([
      { key: 'dedicated', value: 'db', effect: 'NoSchedule' },
      { key: 'spot', value: null, effect: 'PreferNoSchedule' },
    ]);
    expect(
      formatTaints([{ key: 'dedicated', value: 'db', effect: 'NoSchedule' }]),
    ).toBe('dedicated=db:NoSchedule');
  });

  it('rejects a taint without a valid effect', () => {
    expect(() => parseTaints('dedicated=db')).toThrow('needs an effect');
    expect(() => parseTaints('a:Bogus')).toThrow('needs an effect');
  });
});
