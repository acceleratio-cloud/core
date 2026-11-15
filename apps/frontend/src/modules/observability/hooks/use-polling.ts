'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Matches the scrape interval: a faster refresh would show the same data. */
export const METRICS_REFRESH_MS = 15_000;

/**
 * Runs `load` now, then every 15 s while `enabled` and the page is visible,
 * and again when the page becomes visible. Each run aborts the previous one,
 * so an older response never lands after a newer one; unmounting aborts too.
 * Returns a function that refreshes on demand.
 */
export const usePolling = (
  load: (signal: AbortSignal) => Promise<void>,
  enabled = true,
) => {
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    void load(current.signal);
  }, [load]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const refreshVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    refresh();
    const timer = window.setInterval(refreshVisible, METRICS_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      controller.current?.abort();
    };
  }, [enabled, refresh]);

  return refresh;
};
