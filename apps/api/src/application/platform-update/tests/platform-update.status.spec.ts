import {
  MAX_STORED_LOG_LENGTH,
  cleanLog,
  launcherFailureMessage,
  parseReportedStatus,
  statusOfPhase,
} from '../platform-update.status';

describe('parseReportedStatus', () => {
  it('reads the runner status file', () => {
    expect(
      parseReportedStatus(
        [
          'phase=rolled_back',
          'stage=rollback',
          'exit_code=1',
          'message=The update failed; a=b stays intact',
          'reported_at=2026-11-07T10:00:00Z',
          'unknown=ignored',
        ].join('\n'),
      ),
    ).toEqual({
      phase: 'rolled_back',
      stage: 'rollback',
      message: 'The update failed; a=b stays intact',
      exitCode: 1,
      reportedAt: new Date('2026-11-07T10:00:00Z'),
    });
  });

  it('treats unknown values as still running', () => {
    expect(
      parseReportedStatus('phase=exploded\nstage=warp\nexit_code=\n'),
    ).toEqual({
      phase: 'running',
      stage: null,
      message: null,
      exitCode: null,
      reportedAt: null,
    });
  });

  it('maps phases to row statuses', () => {
    expect(statusOfPhase('running')).toBe('running');
    expect(statusOfPhase('succeeded')).toBe('succeeded');
    expect(statusOfPhase('rolled_back')).toBe('rolled_back');
  });
});

describe('cleanLog', () => {
  it('strips terminal colors and carriage returns', () => {
    expect(cleanLog('\u001b[32m[10:00:00]\u001b[0m ok\rnext\r\nend')).toBe(
      '[10:00:00] ok\nnext\r\nend',
    );
  });

  it('keeps the tail of a long log from a line start', () => {
    const line = `${'x'.repeat(99)}\n`;
    const log = line.repeat(
      Math.ceil((MAX_STORED_LOG_LENGTH * 2) / line.length),
    );
    const clean = cleanLog(`first line\n${log}`);

    expect(clean.length).toBeLessThanOrEqual(MAX_STORED_LOG_LENGTH);
    expect(clean.startsWith('x')).toBe(true);
  });
});

describe('launcherFailureMessage', () => {
  it('prefers the line the launcher marked as an error', () => {
    expect(
      launcherFailureMessage(
        'checking\nERROR: Another update is already running on node-1.\nexit',
      ),
    ).toBe(
      'The update could not be started on the server: Another update is already running on node-1.',
    );
  });

  it('falls back to the last line or a generic message', () => {
    expect(launcherFailureMessage('nsenter: permission denied\n')).toBe(
      'The update could not be started on the server: nsenter: permission denied',
    );
    expect(launcherFailureMessage(null)).toBe(
      'The update could not be started on the server.',
    );
  });
});
