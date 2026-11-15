'use client';

import { useCallback, useState } from 'react';

import type { MetricsRange, ProjectMetrics } from '@acceleratio/shared';
import {
  getApiErrorMessage,
  getApiErrorStatus,
  isApiRequestCancelled,
} from '@/api';
import { metricsApi } from '@/api/metrics';
import { usePolling } from './use-polling';

export type MetricsError = {
  message: string;
  /** VictoriaMetrics is missing or down (the API answered 503). */
  unavailable: boolean;
};

type State = {
  data: ProjectMetrics | null;
  error: MetricsError | null;
  isLoading: boolean;
  updatedAt: number | null;
};

/**
 * Loads a project's metrics for `range` and refreshes them every 15 s while
 * `enabled` and the page is visible. The last good data stays on screen
 * during a refresh and after a failed one; a range change replaces it.
 */
export const useProjectMetrics = (
  projectId: string,
  range: MetricsRange,
  enabled: boolean,
) => {
  const [state, setState] = useState<State>({
    data: null,
    error: null,
    isLoading: true,
    updatedAt: null,
  });
  const load = useCallback(
    async (signal: AbortSignal) => {
      setState((previous) => ({ ...previous, isLoading: true }));

      try {
        const data = await metricsApi.get(projectId, range, signal);

        if (!signal.aborted) {
          setState({
            data,
            error: null,
            isLoading: false,
            updatedAt: Date.now(),
          });
        }
      } catch (error) {
        if (signal.aborted || isApiRequestCancelled(error)) {
          return;
        }

        setState((previous) => ({
          ...previous,
          isLoading: false,
          error: {
            message: getApiErrorMessage(error),
            unavailable: getApiErrorStatus(error) === 503,
          },
        }));
      }
    },
    [projectId, range],
  );
  const refresh = usePolling(load, enabled);

  // A new range must not show the previous range's series under its label.
  const data = state.data?.range === range ? state.data : null;

  return { ...state, data, refresh };
};
