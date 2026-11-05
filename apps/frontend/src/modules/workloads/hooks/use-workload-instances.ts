'use client';

import { useEffect, useState } from 'react';

import type { WorkloadInstancesSnapshot } from '@acceleratio/shared';
import { getApiErrorMessage, isApiRequestCancelled } from '@/api';
import { workloadsApi } from '@/api/workloads';

const RECONNECT_DELAY_MS = 5_000;
const STREAM_LOST_MESSAGE =
  'Live updates are paused. Reconnecting to the instance stream…';

type State = {
  data: WorkloadInstancesSnapshot | null;
  error: string | null;
  /** True while the live stream is open. */
  isLive: boolean;
};

const parseSnapshot = (
  data: string,
  workloadId: string,
): WorkloadInstancesSnapshot | null => {
  try {
    const value = JSON.parse(data) as Partial<WorkloadInstancesSnapshot>;

    return value.workload_id === workloadId && Array.isArray(value.instances)
      ? (value as WorkloadInstancesSnapshot)
      : null;
  } catch {
    return null;
  }
};

/**
 * Live instances of a Docker service. One request paints the list at once,
 * then a server-sent event stream pushes every change. The stream closes
 * while the page is hidden and reopens when it is visible again; the last
 * good data stays on screen through drops and errors.
 */
export const useWorkloadInstances = (projectId: string, workloadId: string) => {
  const [state, setState] = useState<State>({
    data: null,
    error: null,
    isLive: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    // The inspector remounts its tabs per workload, so state never carries
    // over from another workload's instances.
    workloadsApi
      .instances(projectId, workloadId, controller.signal)
      .then((data) => {
        // The stream may have delivered a newer frame already.
        setState((previous) =>
          previous.data ? previous : { ...previous, data, error: null },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isApiRequestCancelled(error)) {
          return;
        }

        setState((previous) => ({
          ...previous,
          error: getApiErrorMessage(error),
        }));
      });

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const close = () => {
      clearReconnect();
      source?.close();
      source = null;
      setState((previous) => ({ ...previous, isLive: false }));
    };

    const connect = () => {
      if (disposed || source) {
        return;
      }

      const next = new EventSource(
        workloadsApi.instancesEventsUrl(projectId, workloadId),
        { withCredentials: true },
      );

      source = next;

      next.onopen = () => {
        setState((previous) => ({ ...previous, isLive: true }));
      };

      next.onmessage = (message: MessageEvent<string>) => {
        const data = parseSnapshot(message.data, workloadId);

        if (data) {
          setState({ data, error: null, isLive: true });
        }
      };

      next.onerror = () => {
        // A network drop leaves the source CONNECTING and the browser retries
        // on its own; a closed source has given up and needs a new one.
        if (disposed || next.readyState !== EventSource.CLOSED) {
          setState((previous) => ({ ...previous, isLive: false }));
          return;
        }

        next.close();

        if (source === next) {
          source = null;
        }

        setState((previous) => ({
          ...previous,
          isLive: false,
          error: STREAM_LOST_MESSAGE,
        }));

        if (reconnectTimer === null) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;

            if (document.visibilityState === 'visible') {
              connect();
            }
          }, RECONNECT_DELAY_MS);
        }
      };
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        connect();
      } else {
        close();
      }
    };

    if (document.visibilityState === 'visible') {
      connect();
    }

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      controller.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
      clearReconnect();
      source?.close();
      source = null;
    };
  }, [projectId, workloadId]);

  return state;
};
