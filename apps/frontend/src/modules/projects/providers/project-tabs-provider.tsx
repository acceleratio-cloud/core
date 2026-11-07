'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Narrows the Logs tab to a service and, optionally, one of its pods. */
export type LogsTarget = {
  service?: string;
  pod?: string;
};

/** A request to open the Logs tab; `id` grows so a repeated link applies. */
export type LogsRequest = LogsTarget & { id: number };

type ProjectTabsContextValue = {
  /** Selects the Logs tab filtered to `target`, from any tab of the page. */
  openLogs: (target: LogsTarget) => void;
};

const ProjectTabsContext = createContext<ProjectTabsContextValue | null>(null);

/**
 * Lets content inside a project tab switch tabs. The tab bar writes `?tab=`
 * with `history.replaceState`, which `useSearchParams` does not see, so a
 * plain link to `?tab=logs` cannot be relied on to switch from inside the page.
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
