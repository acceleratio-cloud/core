'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Narrows the Logs tab to a service and, optionally, one of its pods. */
export type LogsTarget = {
  service?: string;
  pod?: string;
};

type ProjectTabsContextValue = {
  /** Selects the Logs tab filtered to `target`, from any tab of the page. */
  openLogs: (target: LogsTarget) => void;
};

const ProjectTabsContext = createContext<ProjectTabsContextValue | null>(null);

/**
 * Lets content inside a project tab switch tabs in place: it rewrites `?tab=`
 * and the Logs filter with `history.replaceState`, so the page keeps its
 * mounted panels instead of navigating.
 */
export const ProjectTabsProvider = ({
  value,
  children,
}: {
  value: ProjectTabsContextValue;
  children: ReactNode;
}) => (
  <ProjectTabsContext.Provider value={value}>
    {children}
  </ProjectTabsContext.Provider>
);

export const useProjectTabs = () => {
  const context = useContext(ProjectTabsContext);

  if (!context) {
    throw new Error('useProjectTabs must be used within ProjectTabsProvider');
  }

  return context;
};
