import { describe, expect, it } from 'bun:test';

import {
  describeSessionClient,
  formatRelativeTime,
  validatePasswordForm,
} from '../utils/password';

describe('validatePasswordForm', () => {
  it('accepts a valid change', () => {
    expect(
      validatePasswordForm({
        current: 'old-pass',
        next: 'new-password',
        confirm: 'new-password',
      }),
    ).toEqual({});
  });

  it('flags every problem', () => {
    expect(
      validatePasswordForm({ current: '', next: 'short', confirm: 'x' }),
    ).toEqual({
      current: 'Enter your current password.',
      next: 'Use at least 8 characters.',
    });
  });

  it('rejects an unchanged password and a mismatched confirmation', () => {
    expect(
      validatePasswordForm({
        current: 'same-password',
        next: 'same-password',
        confirm: 'same-password',
      }).next,
    ).toBeDefined();
    expect(
      validatePasswordForm({
        current: 'old-pass',
        next: 'new-password',
        confirm: 'other-password',
      }).confirm,
    ).toBe('The passwords do not match.');
  });
});

describe('describeSessionClient', () => {
  it('names browser and system', () => {
    expect(
      describeSessionClient(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537',
      ),
    ).toBe('Chrome on macOS');
    expect(describeSessionClient(null)).toBe('Unknown device');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-01-10T12:00:00Z').getTime();

  it('reads naturally', () => {
    expect(formatRelativeTime('2026-01-10T11:59:40Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-01-10T11:55:00Z', now)).toBe(
      '5 minutes ago',
    );
    expect(formatRelativeTime('2026-01-10T11:00:00Z', now)).toBe('1 hour ago');
    expect(formatRelativeTime('2026-01-07T12:00:00Z', now)).toBe('3 days ago');
  });
});
