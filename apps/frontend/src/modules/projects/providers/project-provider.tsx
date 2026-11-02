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

import type { Project, Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60_000;

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

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    workloadsApi
      .list(project.id)
      .then((items) => {
        if (active) {
          setWorkloads(items);
        }
      })
      .catch((requestError) => {
        if (active) {
          setWorkloadsError(getApiErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingWorkloads(false);
        }
      });

    return () => {
      active = false;
    };
  }, [project.id]);

  const hasDeployingWorkload = workloads.some(
    (workload) => workload.status === 'deploying',
  );

  useEffect(() => {
    if (!hasDeployingWorkload) {
      return;
    }

    let active = true;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const interval = window.setInterval(() => {
      if (Date.now() >= deadline) {
        window.clearInterval(interval);
        return;
      }

      workloadsApi
        .list(project.id)
        .then((items) => {
          if (active) {
            setWorkloads(items);
            setWorkloadsError(null);
          }
        })
        .catch((requestError) => {
          if (active) {
            setWorkloadsError(getApiErrorMessage(requestError));
          }
        });
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [project.id, hasDeployingWorkload]);

  const addWorkload = useCallback((workload: Workload) => {
    setWorkloads((currentWorkloads) => [...currentWorkloads, workload]);
  }, []);

  const replaceWorkload = useCallback((workload: Workload) => {
    setWorkloadsError(null);
    setWorkloads((currentWorkloads) =>
      currentWorkloads.map((currentWorkload) =>
        currentWorkload.id === workload.id ? workload : currentWorkload,
      ),
    );
  }, []);

  const refreshWorkloads = useCallback(async () => {
    try {
      const items = await workloadsApi.list(project.id);

      if (isMounted.current) {
        setWorkloads(items);
        setWorkloadsError(null);
      }
    } catch (requestError) {
      if (isMounted.current) {
        setWorkloadsError(getApiErrorMessage(requestError));
      }
    }
  }, [project.id]);

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
