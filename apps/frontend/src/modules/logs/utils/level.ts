import type { LogLevel, LogLevelFilter } from '@acceleratio/shared';

type LevelStyle = {
  label: string;
  /** Three-letter code in the line gutter. */
  code: string;
  text: string;
  /** Swatch and gutter bar. */
  bg: string;
  /** For SVG fills in the frequency chart. */
  color: string;
};

/**
 * Levels wear the status tokens only where they carry status (errors and
 * warnings); the rest step down the neutral ramp so a normal log stays calm.
 */
export const LEVEL_STYLES: Record<LogLevelFilter, LevelStyle> = {
  error: {
    label: 'Error',
    code: 'ERR',
    text: 'text-status-danger',
    bg: 'bg-status-danger',
    color: 'var(--status-danger)',
  },
  warn: {
    label: 'Warning',
    code: 'WRN',
    text: 'text-status-warning',
    bg: 'bg-status-warning',
    color: 'var(--status-warning)',
  },
  info: {
    label: 'Info',
    code: 'INF',
    text: 'text-fg-secondary',
    bg: 'bg-fg-secondary',
    color: 'var(--fg-secondary)',
  },
  debug: {
    label: 'Debug',
    code: 'DBG',
    text: 'text-fg-tertiary',
    bg: 'bg-fg-tertiary',
    color: 'var(--fg-tertiary)',
  },
  unknown: {
    label: 'No level',
    code: '···',
    text: 'text-fg-disabled',
    bg: 'bg-edge-control',
    color: 'var(--edge-control)',
  },
};

export const levelKey = (level: LogLevel | null): LogLevelFilter =>
  level ?? 'unknown';
