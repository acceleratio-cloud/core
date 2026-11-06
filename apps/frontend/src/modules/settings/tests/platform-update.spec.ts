import { describe, expect, it } from 'bun:test';

import type { PlatformUpdate } from '@acceleratio/shared';
import {
  formatElapsed,
  formatVersion,
  isUpdateActive,
  platformStatus,
  updateProgress,
  updateSteps,
} from '../utils/platform-update';

const update = (overrides: Partial<PlatformUpdate>): PlatformUpdate => ({
  id: 'id',
  from_version: '0.1.6',
  to_version: '0.1.7',
  status: 'running',
  stage: 'launch',
  message: null,
  actor: null,
  started_at: '2026-11-07T10:00:00Z',
  finished_at: null,
  reported_at: null,
  ...overrides,
});

const states = (value: PlatformUpdate) =>
  updateSteps(value).map((step) => `${step.stage}:${step.state}`);

describe('updateSteps', () => {
  it('marks the stages before the current one as done', () => {
    expect(states(update({ stage: 'backup' }))).toEqual([
      'launch:done',
      'download:done',
      'prepare:done',
      'backup:current',
      'install:pending',
      'verify:pending',
      'cleanup:pending',
    ]);
  });

  it('marks every stage done after a success', () => {
    expect(
      states(update({ status: 'succeeded', stage: 'done' })).every((state) =>
        state.endsWith(':done'),
      ),
    ).toBe(true);
  });

  it('marks the stage a failed update stopped at', () => {
    expect(states(update({ status: 'failed', stage: 'download' }))).toEqual([
      'launch:done',
      'download:failed',
      'prepare:pending',
      'backup:pending',
      'install:pending',
      'verify:pending',
      'cleanup:pending',
    ]);
  });

  it('adds the rollback after the install stage', () => {
    expect(states(update({ stage: 'rollback' })).slice(-4)).toEqual([
      'install:current',
      'verify:pending',
      'cleanup:pending',
      'rollback:current',
    ]);
    expect(
      states(update({ status: 'rolled_back', stage: 'rollback' })).slice(-1),
    ).toEqual(['rollback:done']);
    expect(
      states(update({ status: 'failed', stage: 'rollback' })).slice(-1),
    ).toEqual(['rollback:failed']);
  });
});

describe('helpers', () => {
  it('tells active updates apart', () => {
    expect(isUpdateActive(update({ status: 'pending' }))).toBe(true);
    expect(isUpdateActive(update({ status: 'rolled_back' }))).toBe(false);
    expect(isUpdateActive(null)).toBe(false);
  });

  it('formats versions with a v', () => {
    expect(formatVersion('0.1.7')).toBe('v0.1.7');
    expect(formatVersion(null)).toBe('Unknown');
  });
});

describe('platformStatus', () => {
  const base = {
    latest_version: '0.1.7',
    update_available: false,
    checked_at: '2026-11-07T10:00:00Z',
    check_error: null,
    active_update: null,
  };

  it('puts a running update first', () => {
    expect(
      platformStatus({
        ...base,
        check_error: 'offline',
        active_update: update({ status: 'running' }),
      }),
    ).toEqual({ tone: 'info', label: 'Updating to v0.1.7', detail: null });
  });

  it('reports a failed check with its reason', () => {
    expect(platformStatus({ ...base, check_error: 'offline' })).toEqual({
      tone: 'danger',
      label: 'Could not check for updates',
      detail: 'offline',
    });
  });

  it('tells available, current and unchecked apart', () => {
    expect(platformStatus({ ...base, update_available: true }).label).toBe(
      'v0.1.7 is available',
    );
    expect(platformStatus(base).label).toBe('Up to date');
    expect(platformStatus({ ...base, checked_at: null }).label).toBe(
      'Not checked yet',
    );
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes and hours', () => {
    const start = '2026-11-07T10:00:00Z';
    expect(formatElapsed(start, '2026-11-07T10:00:09Z')).toBe('9s');
    expect(formatElapsed(start, '2026-11-07T10:04:05Z')).toBe('4m 05s');
    expect(formatElapsed(start, '2026-11-07T11:02:00Z')).toBe('1h 02m');
    expect(formatElapsed(start, '2026-11-07T09:00:00Z')).toBe('0s');
  });
});

describe('updateProgress', () => {
  it('is the share of finished steps', () => {
    expect(updateProgress(updateSteps(update({ stage: 'download' })))).toBe(
      1 / 7,
    );
    expect(
      updateProgress(
        updateSteps(update({ status: 'succeeded', stage: 'done' })),
      ),
    ).toBe(1);
  });
});
