import type {
  PlatformUpdateStage,
  PlatformUpdateStatus,
} from '@acceleratio/shared';

/** Longest log kept in the database. */
export const MAX_STORED_LOG_LENGTH = 128 * 1024;

const STAGES: readonly PlatformUpdateStage[] = [
  'launch',
  'download',
  'prepare',
  'backup',
  'install',
  'verify',
  'cleanup',
  'rollback',
  'done',
];

const FINAL_PHASES = ['succeeded', 'failed', 'rolled_back'] as const;

type FinalPhase = (typeof FINAL_PHASES)[number];

/** What the runner on the server last published. */
export interface ReportedUpdateStatus {
  /** `running`, or the outcome once the update ended. */
  phase: 'running' | FinalPhase;
  stage: PlatformUpdateStage | null;
  message: string | null;
  exitCode: number | null;
  reportedAt: Date | null;
}

export const isUpdateStage = (value: string): value is PlatformUpdateStage =>
  (STAGES as readonly string[]).includes(value);

export const isFinalPhase = (
  phase: ReportedUpdateStatus['phase'],
): phase is FinalPhase => phase !== 'running';

/**
 * Parses the runner's `key=value` status file. Unknown keys are ignored; an
 * unknown phase or stage reads as still running with no stage.
 */
export const parseReportedStatus = (text: string): ReportedUpdateStatus => {
  const values = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('=');

    if (separator > 0) {
      values.set(
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      );
    }
  }

  const phase = values.get('phase') ?? '';
  const stage = values.get('stage') ?? '';
  const exitCode = Number.parseInt(values.get('exit_code') ?? '', 10);
  const reportedAt = new Date(values.get('reported_at') ?? '');

  return {
    phase: (FINAL_PHASES as readonly string[]).includes(phase)
      ? (phase as FinalPhase)
      : 'running',
    stage: isUpdateStage(stage) ? stage : null,
    message: values.get('message') || null,
    exitCode: Number.isNaN(exitCode) ? null : exitCode,
    reportedAt: Number.isNaN(reportedAt.getTime()) ? null : reportedAt,
  };
};

/** The row status for a reported phase. */
export const statusOfPhase = (
  phase: ReportedUpdateStatus['phase'],
): PlatformUpdateStatus => (phase === 'running' ? 'running' : phase);

// CSI sequences (colors, cursor moves) and other escape sequences.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;

/** Strips terminal escapes and keeps the last `MAX_STORED_LOG_LENGTH` chars. */
export const cleanLog = (log: string): string => {
  const clean = log.replace(ANSI, '').replace(/\r(?!\n)/g, '\n');

  if (clean.length <= MAX_STORED_LOG_LENGTH) {
    return clean;
  }

  const tail = clean.slice(-MAX_STORED_LOG_LENGTH);
  const firstBreak = tail.indexOf('\n');
  return firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
};

/**
 * The reason a launcher Job failed, from its log: the line it printed with
 * `ERROR:`, otherwise the last non-empty line.
 */
export const launcherFailureMessage = (log: string | null): string => {
  const lines = (log ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const error = [...lines].reverse().find((line) => line.startsWith('ERROR:'));
  const detail = (error ?? lines.at(-1) ?? '').replace(/^ERROR:\s*/, '');

  return detail
    ? `The update could not be started on the server: ${detail}`
    : 'The update could not be started on the server.';
};
