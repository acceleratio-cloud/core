'use client';

import { useEffect, useRef, useState } from 'react';

import type {
  ProjectLogEntry,
  ProjectLogStreamEvent,
} from '@acceleratio/shared';
import { logsApi, type LogFilterQuery } from '@/api/logs';

export type LogStreamStatus = 'off' | 'connecting' | 'live' | 'reconnecting';

/** Waits between reconnect attempts; the last one repeats. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 15_000];

const parseEvent = (data: string): ProjectLogStreamEvent | null => {
  try {
    return JSON.parse(data) as ProjectLogStreamEvent;
  } catch {
    return null;
  }
};

type Options = {
  projectId: string;
  filters: LogFilterQuery;
  enabled: boolean;
  /** Newest line already shown; the stream resumes right after it. */
  since: () => string | null;
  onEntries: (entries: ProjectLogEntry[]) => void;
  onDropped: (count: number) => void;
};

/**
 * Follows the project's logs over server-sent events while `enabled` and the
 * page is visible. The stream reads from the log store, not from pods, so a
 * deploy that replaces every pod does not interrupt it. A dropped connection
 * reconnects with backoff and resumes after the newest line, so nothing is
 * repeated or skipped.
 */
export const useLogStream = ({
  projectId,
  filters,
  enabled,
  since,
  onEntries,
  onDropped,
}: Options) => {
  const [status, setStatus] = useState<LogStreamStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const filtersKey = JSON.stringify(filters);
  const callbacks = useRef({ since, onEntries, onDropped, filters });

  useEffect(() => {
    callbacks.current = { since, onEntries, onDropped, filters };
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let source: EventSource | null = null;
    let timer: number | null = null;
    let attempt = 0;
    let disposed = false;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const close = () => {
      clearTimer();
      source?.close();
      source = null;
    };

    const scheduleReconnect = () => {
      close();

      if (disposed) {
        return;
      }

      setStatus('reconnecting');
      timer = window.setTimeout(
        connect,
        BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)],
      );
      attempt += 1;
    };

    function connect() {
      if (disposed || source || document.visibilityState !== 'visible') {
        return;
      }

      const { filters, since } = callbacks.current;
      const next = new EventSource(
        logsApi.streamUrl(projectId, filters, since()),
        { withCredentials: true },
      );

      source = next;
      setStatus((previous) =>
        previous === 'reconnecting' ? previous : 'connecting',
      );

      next.onopen = () => {
        attempt = 0;
        setStatus('live');
        setError(null);
      };

      next.onmessage = (message: MessageEvent<string>) => {
        const event = parseEvent(message.data);

        if (!event) {
          return;
        }

        if (event.type === 'entries') {
          callbacks.current.onEntries(event.entries);
        } else if (event.type === 'dropped') {
          callbacks.current.onDropped(event.count);
        } else if (event.type === 'error') {
          setError(event.message);
          scheduleReconnect();
        }
      };

      // The browser would retry with the original URL and replay from an old
      // `since`; reconnecting by hand resumes after the newest line instead.
      next.onerror = () => {
        if (source === next) {
          scheduleReconnect();
        }
      };
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        attempt = 0;
        connect();
      } else {
        close();
        setStatus('reconnecting');
      }
    };

    connect();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      close();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // `filtersKey` stands for `filters`, which is read through the ref.
  }, [projectId, filtersKey, enabled]);

  return { status: enabled ? status : 'off', error };
};
