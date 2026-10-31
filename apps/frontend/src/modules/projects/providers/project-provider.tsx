'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Project, Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';

type ProjectContextValue = {
  project: Project;
  workloads: Workload[];
  isLoadingWorkloads: boolean;
  workloadsError: string | null;
  addWorkload: (workload: Workload) => void;
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

  const addWorkload = useCallback((workload: Workload) => {
    setWorkloads((currentWorkloads) => [...currentWorkloads, workload]);
  }, []);

  const value = useMemo(
    () => ({
      project,
      workloads,
      isLoadingWorkloads,
      workloadsError,
      addWorkload,
    }),
    [project, workloads, isLoadingWorkloads, workloadsError, addWorkload],
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
