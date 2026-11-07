import type { LogLevelFilter, LogRange } from '@acceleratio/shared';

// The console only imports types from @acceleratio/shared (the package is
// not bundled at runtime), so the contract's constants are mirrored here.

/** `LOG_RANGES`, in picker order. */
export const LOG_RANGES: readonly LogRange[] = ['15m', '1h', '6h', '24h', '7d'];

/** `LOG_LEVEL_FILTERS`, most severe first. */
export const LOG_LEVEL_FILTERS: readonly LogLevelFilter[] = [
  'error',
  'warn',
  'info',
  'debug',
  'unknown',
];

/** `MAX_LOG_SEARCH_LENGTH`. */
export const MAX_LOG_SEARCH_LENGTH = 256;

export const RANGE_LABELS: Record<LogRange, string> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
};

/** Lines per history request; the API allows up to 500. */
export const LOG_PAGE_SIZE = 200;

/**
 * Lines the viewer keeps in memory. Live lines push the oldest out; scrolling
 * back past them reloads from the server.
 */
export const MAX_BUFFERED_LINES = 5_000;

/** The chart and the sidebar counts refresh this often in live mode. */
export const OVERVIEW_REFRESH_MS = 15_000;

/** Query parameters a link can use to open the tab already filtered. */
export const LOGS_SERVICE_PARAM = 'service';
export const LOGS_POD_PARAM = 'pod';
