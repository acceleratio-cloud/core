'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ProjectLogHistogram,
  ProjectLogSources,
} from '@acceleratio/shared';
import { isApiRequestCancelled } from '@/api';
import { logsApi, type LogFilterQuery, type LogWindowQuery } from '@/api/logs';
import { OVERVIEW_REFRESH_MS } from '../utils/constants';

type State = {
  histogram: ProjectLogHistogram | null;
  histogramKey: string | null;
  sources: ProjectLogSources | null;
  sourcesKey: string | null;
};

/**
 * The frequency chart (for the current filters) and the services and pods
 * that can be filtered on (for the window only, so a filter never hides its
 * own siblings). Both refresh every 15 s while `live`; failures keep the
 * last good data, since the list already reports a broken backend.
 */
export const useLogOverview = (
  projectId: string,
  timeWindow: LogWindowQuery,
  filters: LogFilterQuery,
  enabled: boolean,
  live: boolean,
) => {
  const histogramKey = JSON.stringify([projectId, timeWindow, filters]);
  const sourcesKey = JSON.stringify([projectId, timeWindow]);
  const [state, setState] = useState<State>({
    histogram: null,
    histogramKey: null,
    sources: null,
    sourcesKey: null,
  });
  const latest = useRef({
    projectId,
    timeWindow,
    filters,
    histogramKey,
    sourcesKey,
  });
  const controllers = useRef<{
    histogram?: AbortController;
    sources?: AbortController;
  }>({});

  useEffect(() => {
    latest.current = {
      projectId,
      timeWindow,
      filters,
      histogramKey,
      sourcesKey,
    };
  });

  const loadHistogram = useCallback(async () => {
    const { projectId, timeWindow, filters, histogramKey } = latest.current;

    controllers.current.histogram?.abort();
    const current = new AbortController();
    controllers.current.histogram = current;

    try {
      const histogram = await logsApi.histogram(
        projectId,
        timeWindow,
        filters,
        current.signal,
      );

      if (!current.signal.aborted) {
        setState((previous) => ({ ...previous, histogram, histogramKey }));
      }
    } catch (error) {
      if (!current.signal.aborted && !isApiRequestCancelled(error)) {
        setState((previous) => ({
          ...previous,
          histogram:
            previous.histogramKey === histogramKey ? previous.histogram : null,
          histogramKey,
        }));
      }
    }
  }, []);

  const loadSources = useCallback(async () => {
    const { projectId, timeWindow, sourcesKey } = latest.current;

    controllers.current.sources?.abort();
    const current = new AbortController();
    controllers.current.sources = current;

    try {
      const sources = await logsApi.sources(
        projectId,
        timeWindow,
        current.signal,
      );

      if (!current.signal.aborted) {
        setState((previous) => ({ ...previous, sources, sourcesKey }));
      }
    } catch (error) {
      if (!current.signal.aborted && !isApiRequestCancelled(error)) {
        setState((previous) => ({ ...previous, sourcesKey }));
      }
    }
  }, []);

  useEffect(() => {
    if (enabled && state.histogramKey !== histogramKey) {
      void loadHistogram();
    }
  }, [enabled, histogramKey, state.histogramKey, loadHistogram]);

  useEffect(() => {
    if (enabled && state.sourcesKey !== sourcesKey) {
      void loadSources();
    }
  }, [enabled, sourcesKey, state.sourcesKey, loadSources]);

  useEffect(() => {
    if (!enabled || !live) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadHistogram();
        void loadSources();
      }
    }, OVERVIEW_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [enabled, live, loadHistogram, loadSources]);

  useEffect(() => {
    const current = controllers.current;

    return () => {
      current.histogram?.abort();
      current.sources?.abort();
    };
  }, []);

  const refresh = useCallback(() => {
    void loadHistogram();
    void loadSources();
  }, [loadHistogram, loadSources]);

  return {
    // A histogram for other filters would draw the wrong bars; sources stay
    // across window changes so the sidebar does not flicker.
    histogram: state.histogramKey === histogramKey ? state.histogram : null,
    sources: state.sources,
    refresh,
  };
};
