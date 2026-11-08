'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import { LogsView } from '@/modules/logs/containers/logs-view';
import { setLogsTargetParams } from '@/modules/logs/utils/links';
import { ObservabilityView } from '@/modules/observability/containers/observability-view';
import { ProjectHeader } from '../components/project-header';
import {
  ProjectTabsProvider,
  type LogsTarget,
} from '../providers/project-tabs-provider';
import {
  DEFAULT_PROJECT_TAB,
  PROJECT_TAB_PARAM,
  projectPanelDomId,
  projectTabDomId,
  projectTabIndex,
  toProjectTabId,
  type ProjectTabId,
} from '../tabs';
import { ProjectCanvas } from './project-canvas';
import { ProjectSettings } from './project-settings';

type Direction = 'forward' | 'backward' | null;

/**
 * The project page: one route, four tabs. `?tab=` (Architecture omits it) is
 * the source of truth, so a reload or a shared link opens the same tab. The tab
 * bar writes it with `history.replaceState(null, …)`: Next syncs that into
 * `useSearchParams` without a server round trip. Passing the current history
 * state instead would carry Next's own marker, and Next would skip the sync and
 * later restore the old URL.
 *
 * Panels mount on first visit and then stay mounted while hidden: the canvas
 * keeps its viewport, selection and status stream, and the dashboard keeps
 * its data. A hidden panel is `display: none`, so its entrance animation
 * replays each time it is shown again.
 */
export const ProjectView = () => {
  const activeTab = toProjectTabId(useSearchParams().get(PROJECT_TAB_PARAM));
  const [visited, setVisited] = useState<ReadonlySet<ProjectTabId>>(
    () => new Set([activeTab]),
  );
  const [direction, setDirection] = useState<Direction>(null);
  const [previousTab, setPreviousTab] = useState(activeTab);

  if (!visited.has(activeTab)) {
    setVisited(new Set([...visited, activeTab]));
  }

  // The entrance slides in from the side of the tab bar the new tab is on.
  if (previousTab !== activeTab) {
    setDirection(
      projectTabIndex(activeTab) > projectTabIndex(previousTab)
        ? 'forward'
        : 'backward',
    );
    setPreviousTab(activeTab);
  }

  const selectTab = useCallback((tab: ProjectTabId) => {
    const url = new URL(window.location.href);

    if (tab === DEFAULT_PROJECT_TAB) {
      url.searchParams.delete(PROJECT_TAB_PARAM);
    } else {
      url.searchParams.set(PROJECT_TAB_PARAM, tab);
    }

    // The Logs tab writes its filter back when it is shown again.
    if (tab !== 'logs') {
      setLogsTargetParams(url.searchParams, {});
    }

    window.history.replaceState(null, '', url);
  }, []);

  const openLogs = useCallback((target: LogsTarget) => {
    const url = new URL(window.location.href);

    url.searchParams.set(PROJECT_TAB_PARAM, 'logs');
    setLogsTargetParams(url.searchParams, target);
    window.history.replaceState(null, '', url);
  }, []);
  const tabsContext = useMemo(() => ({ openLogs }), [openLogs]);

  return (
    <ProjectTabsProvider value={tabsContext}>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-board">
        <div className="pointer-events-none absolute top-3 left-3 z-30 max-w-[calc(100%-1.5rem)]">
          <div className="pointer-events-auto min-w-0">
            <ProjectHeader activeTab={activeTab} onTabChange={selectTab} />
          </div>
        </div>

        <TabPanel
          tab="architecture"
          activeTab={activeTab}
          visited={visited}
          direction={direction}
        >
          <ProjectCanvas />
        </TabPanel>

        <TabPanel
          tab="observability"
          activeTab={activeTab}
          visited={visited}
          direction={direction}
          scrollable
        >
          <ObservabilityView active={activeTab === 'observability'} />
        </TabPanel>

        {/* The log list scrolls inside its own frame, so the panel does not. */}
        <TabPanel
          tab="logs"
          activeTab={activeTab}
          visited={visited}
          direction={direction}
        >
          <LogsView active={activeTab === 'logs'} />
        </TabPanel>

        <TabPanel
          tab="settings"
          activeTab={activeTab}
          visited={visited}
          direction={direction}
          scrollable
        >
          <ProjectSettings />
        </TabPanel>
      </div>
    </ProjectTabsProvider>
  );
};

const TabPanel = ({
  tab,
  activeTab,
  visited,
  direction,
  scrollable = false,
  children,
}: {
  tab: ProjectTabId;
  activeTab: ProjectTabId;
  visited: ReadonlySet<ProjectTabId>;
  direction: Direction;
  scrollable?: boolean;
  children: ReactNode;
}) => {
  const active = tab === activeTab;

  if (!visited.has(tab)) {
    return null;
  }

  return (
    <div
      role="tabpanel"
      id={projectPanelDomId(tab)}
      aria-labelledby={projectTabDomId(tab)}
      hidden={!active}
      inert={!active}
      className={cn(
        'absolute inset-0 flex flex-col',
        scrollable && 'overflow-y-auto overscroll-contain',
        active &&
          direction !== null &&
          'animate-in fade-in-0 duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none',
        active && direction === 'forward' && 'slide-in-from-right-3',
        active && direction === 'backward' && 'slide-in-from-left-3',
      )}
    >
      {children}
    </div>
  );
};
