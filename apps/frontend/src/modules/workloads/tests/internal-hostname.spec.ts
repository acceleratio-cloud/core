import { describe, expect, it } from 'bun:test';

import {
  internalHostnameError,
  normalizeInternalHostname,
} from '@/modules/workloads/utils/internal-hostname';

describe('normalizeInternalHostname', () => {
  it('drops the suffix, spaces and upper case', () => {
    expect(normalizeInternalHostname(' Postgres.internal ')).toBe('postgres');
    expect(normalizeInternalHostname('db.internal.')).toBe('db');
    expect(normalizeInternalHostname('db')).toBe('db');
  });
});

describe('internalHostnameError', () => {
  it('accepts DNS labels that start with a letter', () => {
    expect(internalHostnameError('postgres')).toBeNull();
    expect(internalHostnameError('my-api-2')).toBeNull();
    expect(internalHostnameError('Cache.internal')).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(internalHostnameError('  ')).toBe('Enter a hostname.');
    expect(internalHostnameError('2db')).toBe('Start with a letter.');
    expect(internalHostnameError('db-')).toMatch(/do not end with a hyphen/);
    expect(internalHostnameError('my_db')).toMatch(/lowercase letters/);
    expect(internalHostnameError('a'.repeat(51))).toMatch(/at most 50/);
  });
});
