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

import { MAX_TERMINAL_TABS } from '../constants';

/** The instance a terminal tab is connected to. */
export type TerminalTarget = {
  projectId: string;
  workloadId: string;
  workloadName: string;
  /** Pod name. */
  pod: string;
};

export type TerminalStatus = 'connecting' | 'connected' | 'closed';

export type TerminalTab = TerminalTarget & {
  id: string;
  status: TerminalStatus;
  /** Tells apart several shells on the same instance: 1, 2, 3… */
  ordinal: number;
};

type TerminalContextValue = {
  tabs: TerminalTab[];
  activeTabId: string | null;
  /** False once the dock holds `MAX_TERMINAL_TABS` tabs. */
  canOpen: boolean;
  /** Opens a new tab on the instance and selects it. */
  openTerminal: (target: TerminalTarget) => void;
  selectTab: (id: string) => void;
  /** Closing the last tab closes the dock. */
  closeTab: (id: string) => void;
  /** Ends every session and closes the dock. */
  closeAll: () => void;
  setTabStatus: (id: string, status: TerminalStatus) => void;
};

const TerminalContext = createContext<TerminalContextValue | null>(null);

let nextTabId = 0;

/**
 * Terminal sessions of one project. Mounted by the project page inside its
 * keyed `ProjectProvider`, so tabs keep running while the user moves between
 * the project's services and tabs, and every session ends when the user
 * leaves the page (including when Next keeps it hidden in the background) or
 * switches projects. The dock is open whenever a tab
 * exists.
 */
export const TerminalProvider = ({ children }: { children: ReactNode }) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Next keeps a page the user left mounted but hidden (React Activity),
  // which runs effect cleanups. Ending every session then keeps terminals
  // from living on, unseen, behind another page.
  useEffect(
    () => () => {
      setTabs([]);
      setActiveTabId(null);
    },
    [],
  );

  const openTerminal = useCallback((target: TerminalTarget) => {
    const id = `terminal-${(nextTabId += 1)}`;

    setTabs((previous) => {
      if (previous.length >= MAX_TERMINAL_TABS) {
        return previous;
      }

      setActiveTabId(id);

      // The lowest number no open shell on this instance is using.
      const taken = new Set(
        previous
          .filter((tab) => tab.pod === target.pod)
          .map((tab) => tab.ordinal),
      );
      let ordinal = 1;

      while (taken.has(ordinal)) {
        ordinal += 1;
      }

      return [...previous, { ...target, id, status: 'connecting', ordinal }];
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((previous) => {
      const index = previous.findIndex((tab) => tab.id === id);

      if (index === -1) {
        return previous;
      }

      const next = previous.filter((tab) => tab.id !== id);

      // The neighbour takes over, preferring the one to the left.
      setActiveTabId((active) =>
        active === id ? (next[Math.max(0, index - 1)]?.id ?? null) : active,
      );

      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const setTabStatus = useCallback((id: string, status: TerminalStatus) => {
    setTabs((previous) =>
      previous.some((tab) => tab.id === id && tab.status !== status)
        ? previous.map((tab) => (tab.id === id ? { ...tab, status } : tab))
        : previous,
    );
  }, []);

  const value = useMemo<TerminalContextValue>(
    () => ({
      tabs,
      activeTabId,
      canOpen: tabs.length < MAX_TERMINAL_TABS,
      openTerminal,
      selectTab: setActiveTabId,
      closeTab,
      closeAll,
      setTabStatus,
    }),
    [tabs, activeTabId, openTerminal, closeTab, closeAll, setTabStatus],
  );

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
};

export const useTerminal = () => {
  const context = useContext(TerminalContext);

  if (!context) {
    throw new Error('useTerminal must be used within TerminalProvider');
  }

  return context;
};
