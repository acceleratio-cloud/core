'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import { ObservabilityView } from '@/modules/observability/containers/observability-view';
import { ProjectHeader } from '../components/project-header';
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
 * The project page: one route, three tabs. The selected tab is local state,
 * mirrored into `?tab=` (Overview omits it) with `history.replaceState` so a
 * reload or a shared link opens the same tab without a server round trip.
 * The URL is storage, not the source of truth: with Cache Components on,
 * `replaceState` does not re-render `useSearchParams` consumers. A real
 * navigation to another `?tab=` (a link, the project switcher) still changes
 * `useSearchParams`, and that is applied to the state.
 *
 * Panels mount on first visit and then stay mounted while hidden: the canvas
 * keeps its viewport, selection and status stream, and the dashboard keeps
 * its data. A hidden panel is `display: none`, so its entrance animation
 * replays each time it is shown again.
 */
export const ProjectView = () => {
  const urlTab = toProjectTabId(useSearchParams().get(PROJECT_TAB_PARAM));
  const [activeTab, setActiveTab] = useState(urlTab);
  const [lastUrlTab, setLastUrlTab] = useState(urlTab);
  const [visited, setVisited] = useState<ReadonlySet<ProjectTabId>>(
    () => new Set([activeTab]),
  );
  const [direction, setDirection] = useState<Direction>(null);
  const [previousTab, setPreviousTab] = useState(activeTab);

  // A navigation that changed `?tab=` (not the tab bar) selects that tab;
  // this is the "adjust state while rendering" pattern.
  if (urlTab !== lastUrlTab) {
    setLastUrlTab(urlTab);
    setActiveTab(urlTab);
  }

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

  const selectTab = useCallback(
    (tab: ProjectTabId) => {
      if (tab === activeTab) {
        return;
      }

      const url = new URL(window.location.href);

      if (tab === DEFAULT_PROJECT_TAB) {
        url.searchParams.delete(PROJECT_TAB_PARAM);
      } else {
        url.searchParams.set(PROJECT_TAB_PARAM, tab);
      }

      setActiveTab(tab);
      window.history.replaceState(window.history.state, '', url);
    },
    [activeTab],
  );

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-board">
      <div className="pointer-events-none absolute top-3 left-3 z-30 max-w-[calc(100%-1.5rem)]">
        <div className="pointer-events-auto min-w-0">
          <ProjectHeader activeTab={activeTab} onTabChange={selectTab} />
        </div>
      </div>

      <TabPanel
        tab="overview"
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
