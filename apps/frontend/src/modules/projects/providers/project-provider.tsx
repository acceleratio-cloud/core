'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type {
  Project,
  Workload,
  WorkloadStatusEvent,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';

type ProjectContextValue = {
  project: Project;
  workloads: Workload[];
  isLoadingWorkloads: boolean;
  workloadsError: string | null;
  addWorkload: (workload: Workload) => void;
  replaceWorkload: (workload: Workload) => void;
  refreshWorkloads: () => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

const WORKLOAD_STATUSES = new Set<string>([
  'draft',
  'deploying',
  'running',
  'stopped',
  'failed',
]);

const STREAM_RECONNECT_DELAY_MS = 5000;
const WORKLOAD_RECONCILE_INTERVAL_MS = 60_000;
const STREAM_UNAVAILABLE_MESSAGE =
  'Lost the workload status stream. Reconnecting...';

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isWorkloadStatusEvent = (
  value: unknown,
): value is WorkloadStatusEvent => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.workload_id === 'string' &&
    typeof event.project_id === 'string' &&
    typeof event.status === 'string' &&
    WORKLOAD_STATUSES.has(event.status) &&
    isNullableString(event.status_message) &&
    isNullableString(event.status_observed_at) &&
    typeof event.updated_at === 'string'
  );
};

const parseWorkloadStatusEvent = (data: string): WorkloadStatusEvent | null => {
  try {
    const event: unknown = JSON.parse(data);

    return isWorkloadStatusEvent(event) ? event : null;
  } catch {
    return null;
  }
};

const applyWorkloadStatusEvent = (
  workloads: Workload[],
  event: WorkloadStatusEvent,
): Workload[] => {
  let changed = false;

  const nextWorkloads = workloads.map((workload) => {
    if (
      workload.id !== event.workload_id ||
      event.updated_at < workload.updated_at
    ) {
      return workload;
    }

    changed = true;

    return {
      ...workload,
      status: event.status,
      status_message: event.status_message,
      status_observed_at: event.status_observed_at,
      updated_at: event.updated_at,
    };
  });

  return changed ? nextWorkloads : workloads;
};

const mergeWorkloads = (
  currentWorkloads: Workload[],
  incomingWorkloads: Workload[],
): Workload[] => {
  const currentById = new Map(
    currentWorkloads.map((workload) => [workload.id, workload]),
  );

  return incomingWorkloads.map((workload) => {
    const currentWorkload = currentById.get(workload.id);

    if (!currentWorkload) {
      return workload;
    }

    return workload.updated_at >= currentWorkload.updated_at
      ? workload
      : currentWorkload;
  });
};

export const ProjectProvider = ({
  project,
  children,
}: {
  project: Project;
  children: ReactNode;
}) => {
  const [workloads, setWorkloads] = useState<Workload[]>([]);
  const [isLoadingWorkloads, setIsLoadingWorkloads] = useState(true);
  const [workloadsError, setWorkloadsError] = useState<string | null>(null);
  const isMounted = useRef(true);
  const workloadsRef = useRef<Workload[]>([]);
  const listRequestId = useRef(0);

  useEffect(() => {
    workloadsRef.current = workloads;
  }, [workloads]);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  // Every list load takes the next request id and applies its response only
  // while it is still the latest request, so a slow response cannot overwrite
  // a newer one (for example a list that started before a create committed).
  const loadWorkloads = useCallback(async () => {
    const requestId = ++listRequestId.current;

    try {
      const items = await workloadsApi.list(project.id);

      if (isMounted.current && requestId === listRequestId.current) {
        setWorkloads((currentWorkloads) =>
          mergeWorkloads(currentWorkloads, items),
        );
        setWorkloadsError(null);
      }
    } catch (requestError) {
      if (isMounted.current && requestId === listRequestId.current) {
        setWorkloadsError(getApiErrorMessage(requestError));
      }
    } finally {
      if (isMounted.current && requestId === listRequestId.current) {
        setIsLoadingWorkloads(false);
      }
    }
  }, [project.id]);

  useEffect(() => {
    const requestId = ++listRequestId.current;

    workloadsApi
      .list(project.id)
      .then((items) => {
        if (isMounted.current && requestId === listRequestId.current) {
          setWorkloads((currentWorkloads) =>
            mergeWorkloads(currentWorkloads, items),
          );
          setWorkloadsError(null);
        }
      })
      .catch((requestError) => {
        if (isMounted.current && requestId === listRequestId.current) {
          setWorkloadsError(getApiErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (isMounted.current && requestId === listRequestId.current) {
          setIsLoadingWorkloads(false);
        }
      });

    return () => {
      // Invalidate any list request still in flight for this project.
      listRequestId.current += 1;
    };
  }, [project.id]);

  const refreshWorkloads = useCallback(() => loadWorkloads(), [loadWorkloads]);

  const addWorkload = useCallback(
    (workload: Workload) => {
      setWorkloads((currentWorkloads) => [...currentWorkloads, workload]);
      // A list that started before the create would drop the new row, so
      // start a fresh request that is guaranteed to be the latest one.
      void refreshWorkloads();
    },
    [refreshWorkloads],
  );

  const replaceWorkload = useCallback((workload: Workload) => {
    setWorkloadsError(null);
    setWorkloads((currentWorkloads) =>
      currentWorkloads.map((currentWorkload) => {
        if (currentWorkload.id !== workload.id) {
          return currentWorkload;
        }

        return workload.updated_at >= currentWorkload.updated_at
          ? workload
          : currentWorkload;
      }),
    );
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      const nextSource = new EventSource(workloadsApi.eventsUrl(project.id), {
        withCredentials: true,
      });

      source = nextSource;

      nextSource.onopen = () => {
        // Every successful open reconciles the list: a write can land between
        // the mount list and the subscription, and this is also the success
        // path that clears an error from a failed first connect.
        void refreshWorkloads();
      };

      nextSource.onmessage = (message) => {
        const event = parseWorkloadStatusEvent(message.data);

        if (!event || event.project_id !== project.id) {
          return;
        }

        const isKnown = workloadsRef.current.some(
          (workload) => workload.id === event.workload_id,
        );

        if (!isKnown) {
          void refreshWorkloads();
          return;
        }

        setWorkloads((currentWorkloads) =>
          applyWorkloadStatusEvent(currentWorkloads, event),
        );
      };

      nextSource.onerror = () => {
        // A network drop leaves the source CONNECTING and the browser retries
        // on its own. A closed source has given up (for example a non-200
        // response), so the console has to reconnect itself.
        if (disposed || nextSource.readyState !== EventSource.CLOSED) {
          return;
        }

        nextSource.close();

        if (source === nextSource) {
          source = null;
        }

        setWorkloadsError(STREAM_UNAVAILABLE_MESSAGE);

        if (reconnectTimer !== null) {
          return;
        }

        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;

          if (!disposed) {
            connect();
          }
        }, STREAM_RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      source?.close();
      source = null;
    };
  }, [project.id, refreshWorkloads]);

  // Status still arrives only over the SSE stream above. This reconciliation
  // exists for set membership: the stream does not publish deletes, so a
  // workload removed by another client would otherwise stay on the canvas.
  // It is not status polling, and every load takes the next list request id,
  // so a slow response cannot overwrite a newer one.
  useEffect(() => {
    const reconcileWorkloads = () => {
      void refreshWorkloads();
    };

    const intervalId = window.setInterval(
      reconcileWorkloads,
      WORKLOAD_RECONCILE_INTERVAL_MS,
    );

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconcileWorkloads();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshWorkloads]);

  const value = useMemo(
    () => ({
      project,
      workloads,
      isLoadingWorkloads,
      workloadsError,
      addWorkload,
      replaceWorkload,
      refreshWorkloads,
    }),
    [
      project,
      workloads,
      isLoadingWorkloads,
      workloadsError,
      addWorkload,
      replaceWorkload,
      refreshWorkloads,
    ],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);

  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }

  return context;
};
