'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { cn } from '@/lib/utils';
import { Separator } from '@/shared/components/ui/separator';
import { ProjectSwitcher } from '../containers/project-switcher';
import {
  PROJECT_TABS,
  projectPanelDomId,
  projectTabDomId,
  projectTabIndex,
  type ProjectTabId,
} from '../tabs';

type ProjectHeaderProps = {
  activeTab: ProjectTabId;
  onTabChange: (tab: ProjectTabId) => void;
};

/**
 * The floating project bar: the project switcher and the section tabs. The
 * active tab is marked by one pill that slides between tabs, measured from the
 * buttons so it follows label widths and font loading.
 */
export const ProjectHeader = ({
  activeTab,
  onTabChange,
}: ProjectHeaderProps) => {
  const tabRefs = useRef(new Map<ProjectTabId, HTMLButtonElement>());
  const indicatorRef = useRef<HTMLSpanElement>(null);
  // The first placement must not animate in from the left edge.
  const [hasPlaced, setHasPlaced] = useState(false);

  // Writes the pill geometry as CSS variables, which the transition animates.
  const measure = useCallback(() => {
    const button = tabRefs.current.get(activeTab);
    const indicator = indicatorRef.current;

    if (!button || !indicator) {
      return;
    }

    indicator.style.setProperty('--tab-x', `${button.offsetLeft}px`);
    indicator.style.setProperty('--tab-w', `${button.offsetWidth}px`);
  }, [activeTab]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setHasPlaced(true));

    return () => cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);

    for (const button of tabRefs.current.values()) {
      observer.observe(button);
    }

    return () => observer.disconnect();
  }, [measure]);

  const focusTab = (id: ProjectTabId) => {
    tabRefs.current.get(id)?.focus();
    onTabChange(id);
  };

  // Roving focus per the WAI-ARIA tabs pattern; selection follows focus.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = projectTabIndex(activeTab);
    const last = PROJECT_TABS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;

    if (next === null) {
      return;
    }

    event.preventDefault();
    focusTab(PROJECT_TABS[next].id);
  };

  return (
    <header className="flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-surface-raised p-1 pl-1.5 shadow-float">
      <ProjectSwitcher activeTab={activeTab} />

      <Separator orientation="vertical" className="h-4 shrink-0 self-center!" />

      <div
        role="tablist"
        aria-label="Project sections"
        onKeyDown={handleKeyDown}
        className="relative flex shrink-0 items-center gap-0.5"
      >
        <span
          ref={indicatorRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-(--tab-w) translate-x-(--tab-x) rounded-lg bg-muted',
            hasPlaced
              ? 'opacity-100 transition-[translate,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
              : 'opacity-0',
          )}
        />

        {PROJECT_TABS.map((tab) => {
          const active = tab.id === activeTab;

          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) {
                  tabRefs.current.set(tab.id, node);
                } else {
                  tabRefs.current.delete(tab.id);
                }
              }}
              type="button"
              role="tab"
              id={projectTabDomId(tab.id)}
              aria-selected={active}
              aria-controls={projectPanelDomId(tab.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'relative z-10 flex h-7.5 cursor-pointer items-center rounded-lg px-3 text-[13px] whitespace-nowrap outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-foreground/60',
                active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {/* The hidden medium-weight copy reserves the active width, so
                  switching weight never shifts the tabs or the pill. */}
              <span className="grid">
                <span
                  aria-hidden
                  className="invisible col-start-1 row-start-1 font-medium"
                >
                  {tab.label}
                </span>
                <span className="col-start-1 row-start-1 text-center">
                  {tab.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </header>
  );
};
