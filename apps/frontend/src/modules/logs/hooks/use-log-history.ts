'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProjectLogEntry } from '@acceleratio/shared';
import {
  getApiErrorMessage,
  getApiErrorStatus,
  isApiRequestCancelled,
} from '@/api';
import { logsApi, type LogFilterQuery, type LogWindowQuery } from '@/api/logs';
import { LOG_PAGE_SIZE, MAX_BUFFERED_LINES } from '../utils/constants';
import { appendOlder, prependLive } from '../utils/entries';

export type LogsError = {
  message: string;
  /** VictoriaLogs is missing or down (the API answered 503). */
  unavailable: boolean;
};

type State = {
  /** The query the entries belong to; a new query starts from nothing. */
  key: string | null;
  entries: ProjectLogEntry[];
  nextCursor: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: LogsError | null;
};

const toError = (error: unknown): LogsError => ({
  message: getApiErrorMessage(error),
  unavailable: getApiErrorStatus(error) === 503,
});

/**
 * The history the viewer shows, newest first: the first page of the window
 * on every query change, older pages on demand, and live lines added on top.
 * Loading waits for `enabled`, so a tab that was never opened costs nothing;
 * a hidden tab keeps what it loaded.
 */
export const useLogHistory = (
  projectId: string,
  timeWindow: LogWindowQuery,
  filters: LogFilterQuery,
  enabled: boolean,
) => {
  const key = JSON.stringify([projectId, timeWindow, filters]);
  const [state, setState] = useState<State>({
    key: null,
    entries: [],
    nextCursor: null,
    isLoading: true,
    isLoadingMore: false,
    error: null,
  });
  const controller = useRef<AbortController | null>(null);
  // The latest arguments, for callbacks that must not change identity.
  const latest = useRef({ projectId, timeWindow, filters, key });

  useEffect(() => {
    latest.current = { projectId, timeWindow, filters, key };
  });

  const load = useCallback(async () => {
    const { projectId, timeWindow, filters, key } = latest.current;

    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;

    setState((previous) => ({
      ...previous,
      // Keep the old lines on a plain reload; drop them for a new query.
      ...(previous.key === key ? {} : { entries: [], nextCursor: null }),
      key,
      isLoading: true,
      isLoadingMore: false,
      error: null,
    }));

    try {
      const page = await logsApi.page(projectId, timeWindow, filters, {
        limit: LOG_PAGE_SIZE,
        signal: current.signal,
      });

      if (!current.signal.aborted) {
        setState({
          key,
          entries: page.entries,
          nextCursor: page.next_cursor,
          isLoading: false,
          isLoadingMore: false,
          error: null,
        });
      }
    } catch (error) {
      if (current.signal.aborted || isApiRequestCancelled(error)) {
        return;
      }

      setState((previous) => ({
        ...previous,
        isLoading: false,
        error: toError(error),
      }));
    }
  }, []);

  useEffect(() => {
    if (enabled && state.key !== key) {
      void load();
    }
  }, [enabled, key, state.key, load]);

  useEffect(() => () => controller.current?.abort(), []);

  const loadOlder = useCallback(async () => {
    const cursor = state.nextCursor;

    if (!cursor || state.isLoading || state.isLoadingMore) {
      return;
    }

    const { projectId, timeWindow, filters, key } = latest.current;
    const current = new AbortController();
    controller.current = current;

    setState((previous) => ({ ...previous, isLoadingMore: true }));

    try {
      const page = await logsApi.page(projectId, timeWindow, filters, {
        cursor,
        limit: LOG_PAGE_SIZE,
        signal: current.signal,
      });

      if (!current.signal.aborted) {
        setState((previous) =>
          previous.key === key
            ? {
                ...previous,
                entries: appendOlder(previous.entries, page.entries),
                nextCursor: page.next_cursor,
                isLoadingMore: false,
              }
            : previous,
        );
      }
    } catch (error) {
      if (current.signal.aborted || isApiRequestCancelled(error)) {
        return;
      }

      setState((previous) => ({
        ...previous,
        isLoadingMore: false,
        error: toError(error),
      }));
    }
  }, [state.nextCursor, state.isLoading, state.isLoadingMore]);

  /** Puts live lines on top; lines pushed out at the bottom stay loadable. */
  const prepend = useCallback((incoming: ProjectLogEntry[]) => {
    setState((previous) => {
      const { entries, trimmed } = prependLive(
        previous.entries,
        incoming,
        MAX_BUFFERED_LINES,
      );

      if (entries === previous.entries) {
        return previous;
      }

      return {
        ...previous,
        entries,
        nextCursor:
          trimmed > 0 ? entries[entries.length - 1].time : previous.nextCursor,
      };
    });
  }, []);

  const isCurrent = state.key === key;

  return {
    entries: isCurrent ? state.entries : [],
    nextCursor: isCurrent ? state.nextCursor : null,
    isLoading: !isCurrent || state.isLoading,
    isLoadingMore: state.isLoadingMore,
    error: state.error,
    loadOlder,
    prepend,
    reload: load,
  };
};
