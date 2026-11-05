'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { SquareTerminal, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { shortInstanceName } from '@/modules/workloads/utils/instance-name';
import { TerminalSession } from '../components/terminal-session';
import { MAX_TERMINAL_TABS } from '../constants';
import {
  useTerminal,
  type TerminalStatus,
  type TerminalTab,
} from '../providers/terminal-provider';

const HEIGHT_STORAGE_KEY = 'acceleratio.terminal.height';
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 160;
const MAX_HEIGHT_RATIO = 0.7;
const KEYBOARD_STEP = 24;
/** Open and close: the dock's height and the page above move together. */
const TRANSITION_MS = 320;
const TRANSITION_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const maxHeight = () =>
  Math.max(MIN_HEIGHT, Math.round(window.innerHeight * MAX_HEIGHT_RATIO));

const clampHeight = (height: number) =>
  Math.min(Math.max(Math.round(height), MIN_HEIGHT), maxHeight());

const readStoredHeight = () => {
  const stored = Number(window.localStorage.getItem(HEIGHT_STORAGE_KEY));

  return clampHeight(
    Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_HEIGHT,
  );
};

const statusDot: Record<TerminalStatus, { className: string; label: string }> =
  {
    connecting: {
      className:
        'animate-pulse bg-terminal-fg-muted motion-reduce:animate-none',
      label: 'Connecting',
    },
    connected: { className: 'bg-status-success', label: 'Connected' },
    closed: {
      className: 'border border-terminal-fg-muted bg-transparent',
      label: 'Disconnected',
    },
  };

const iconButton =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm text-terminal-fg-muted transition-colors hover:bg-terminal-tab-active hover:text-terminal-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-terminal-fg';

const TerminalTabButton = ({
  tab,
  showOrdinal,
  selected,
  onSelect,
  onClose,
  onKeyDown,
}: {
  tab: TerminalTab;
  /** True when another tab is open on the same instance. */
  showOrdinal: boolean;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) => {
  const dot = statusDot[tab.status];
  const name = `${tab.workloadName} / ${shortInstanceName(tab.pod)}${
    showOrdinal ? ` (${tab.ordinal})` : ''
  }`;

  return (
    <div
      className={cn(
        'group/tab relative flex h-full max-w-56 min-w-28 shrink items-center border-r border-terminal-edge',
        selected
          ? 'bg-terminal-surface text-terminal-fg'
          : 'text-terminal-fg-muted hover:bg-terminal-tab-active/60 hover:text-terminal-fg',
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-terminal-fg/70"
        />
      ) : null}
      <button
        type="button"
        role="tab"
        id={`${tab.id}-tab`}
        aria-selected={selected}
        aria-controls={`${tab.id}-panel`}
        tabIndex={selected ? 0 : -1}
        title={`${name} · ${tab.pod}`}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className="flex h-full min-w-0 cursor-pointer items-center gap-2 pr-1 pl-3 font-mono text-xs outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-terminal-fg"
      >
        <span
          aria-hidden="true"
          className={cn('size-1.5 shrink-0 rounded-full', dot.className)}
        />
        <span className="sr-only">{dot.label}: </span>
        <span className="truncate">
          <span>{tab.workloadName}</span>
          <span className="text-terminal-fg-muted">
            {' / '}
            {shortInstanceName(tab.pod)}
          </span>
        </span>
        {showOrdinal ? (
          <span
            aria-hidden="true"
            className="shrink-0 rounded-sm bg-terminal-tab-active px-1 text-[10px] leading-4 text-terminal-fg-muted tabular-nums"
          >
            {tab.ordinal}
          </span>
        ) : null}
        <span className="sr-only">
          {showOrdinal ? `, shell ${tab.ordinal}` : ''}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close terminal ${name}`}
        onClick={onClose}
        className={cn(
          iconButton,
          'mr-1.5 size-5',
          selected
            ? 'opacity-100'
            : 'opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100',
        )}
      >
        <X aria-hidden="true" className="size-3" strokeWidth={2} />
      </button>
    </div>
  );
};

/**
 * The instance terminal: a dark dock along the bottom of the project page
 * that pushes the view up rather than covering it. The top edge resizes it (drag or arrow keys);
 * the height is remembered. Each tab is its own shell, and the close button
 * on the right ends all of them.
 */
export const TerminalDock = () => {
  const { tabs, activeTabId, selectTab, closeTab, closeAll, setTabStatus } =
    useTerminal();
  // Nothing renders until a tab opens in the browser, so the server never
  // needs the stored height.
  const [height, setHeight] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_HEIGHT : readStoredHeight(),
  );
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const isOpen = tabs.length > 0;
  const [isDragging, setIsDragging] = useState(false);
  // The dock stays mounted through its closing animation, still showing the
  // tabs it had; `entered` flips a frame after mount so opening animates too.
  const [isPresent, setIsPresent] = useState(isOpen);
  const [entered, setEntered] = useState(false);
  const [shownTabs, setShownTabs] = useState(tabs);

  if (isOpen && !isPresent) {
    setIsPresent(true);
  }

  if (isOpen && shownTabs !== tabs) {
    setShownTabs(tabs);
  }

  // A page hidden in the background drops its sessions (TerminalProvider);
  // the dock goes with them at once, so returning never replays a close.
  useEffect(
    () => () => {
      setIsPresent(false);
      setEntered(false);
      setShownTabs([]);
    },
    [],
  );

  useEffect(() => {
    if (!isPresent) {
      return;
    }

    if (isOpen) {
      // Two frames: the collapsed state must be painted before expanding.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setEntered(true));
      });

      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }

    const frame = requestAnimationFrame(() => setEntered(false));
    const timer = window.setTimeout(() => {
      setIsPresent(false);
      setShownTabs([]);
    }, TRANSITION_MS);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [isOpen, isPresent]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleResize = () => setHeight((value) => clampHeight(value));

    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  // A newly opened or selected tab may sit past the edge of the strip.
  useEffect(() => {
    if (!activeTabId) {
      return;
    }

    tabListRef.current
      ?.querySelector(`#${activeTabId}-tab`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  const commitHeight = useCallback((next: number) => {
    const value = clampHeight(next);

    setHeight(value);
    window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(value));
  }, []);

  if (!isPresent) {
    return null;
  }

  const expanded = isOpen && entered;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startY: event.clientY, startHeight: height };
    setIsDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (drag) {
      setHeight(clampHeight(drag.startHeight + drag.startY - event.clientY));
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag) {
      return;
    }

    dragRef.current = null;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    commitHeight(drag.startHeight + drag.startY - event.clientY);
  };

  const handleSeparatorKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === 'ArrowUp'
        ? KEYBOARD_STEP
        : event.key === 'ArrowDown'
          ? -KEYBOARD_STEP
          : null;

    if (event.key === 'Home') {
      event.preventDefault();
      commitHeight(maxHeight());
    } else if (event.key === 'End') {
      event.preventDefault();
      commitHeight(MIN_HEIGHT);
    } else if (delta !== null) {
      event.preventDefault();
      commitHeight(height + delta);
    }
  };

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const handleTabKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const offset =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

    if (offset === 0) {
      return;
    }

    event.preventDefault();

    const next = tabs[(index + offset + tabs.length) % tabs.length];

    selectTab(next.id);
    tabListRef.current
      ?.querySelector<HTMLButtonElement>(`#${next.id}-tab`)
      ?.focus();
  };

  return (
    // The outer box animates the space the dock takes (and so the project
    // view above); the dock inside keeps its full height and slides up into it,
    // so the terminal never reflows mid-animation.
    <div
      className="shrink-0 overflow-hidden motion-reduce:transition-none"
      style={{
        height: expanded ? height : 0,
        transitionProperty: isDragging ? 'none' : 'height',
        transitionDuration: `${TRANSITION_MS}ms`,
        transitionTimingFunction: TRANSITION_EASE,
      }}
      inert={!isOpen}
    >
      <section
        aria-label="Instance terminal"
        className={cn(
          'relative flex flex-col overflow-hidden border-t border-terminal-edge bg-terminal-surface text-terminal-fg transition-[opacity,translate] motion-reduce:transition-none',
          expanded ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        )}
        style={{
          height,
          transitionDuration: `${TRANSITION_MS}ms`,
          transitionTimingFunction: TRANSITION_EASE,
        }}
      >
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={
            typeof window === 'undefined' ? undefined : maxHeight()
          }
          aria-valuenow={height}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleSeparatorKey}
          className="group/handle absolute inset-x-0 top-0 z-10 flex h-2 cursor-row-resize touch-none justify-center outline-none"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 h-0.5 w-10 rounded-full bg-terminal-edge transition-colors group-hover/handle:bg-terminal-fg-muted group-focus-visible/handle:bg-terminal-fg"
          />
        </div>

        <div className="flex h-9 shrink-0 items-stretch border-b border-terminal-edge bg-terminal-chrome">
          <span className="flex shrink-0 items-center gap-1.5 border-r border-terminal-edge px-3 font-mono text-[11px] tracking-wide text-terminal-fg-muted uppercase">
            <SquareTerminal
              aria-hidden="true"
              className="size-3.5"
              strokeWidth={1.75}
            />
            Terminal
          </span>
          <div
            ref={tabListRef}
            role="tablist"
            aria-label="Terminal sessions"
            className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]"
          >
            {shownTabs.map((tab, index) => (
              <TerminalTabButton
                key={tab.id}
                tab={tab}
                showOrdinal={shownTabs.some(
                  (other) => other.id !== tab.id && other.pod === tab.pod,
                )}
                selected={tab.id === activeTabId}
                onSelect={() => selectTab(tab.id)}
                onClose={() => closeTab(tab.id)}
                onKeyDown={(event) => handleTabKey(event, index)}
              />
            ))}
          </div>
          <span
            className="flex shrink-0 items-center px-3 font-mono text-[11px] text-terminal-fg-muted tabular-nums"
            title={`Up to ${MAX_TERMINAL_TABS} terminals at once`}
          >
            {shownTabs.length}/{MAX_TERMINAL_TABS}
          </span>
          <button
            type="button"
            aria-label="Close terminal and end all sessions"
            title="Close terminal"
            onClick={closeAll}
            className={cn(iconButton, 'my-1.5 mr-1.5 size-6')}
          >
            <X aria-hidden="true" className="size-3.5" strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {shownTabs.map((tab) => (
            <TerminalSession
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              onStatusChange={setTabStatus}
            />
          ))}
        </div>
      </section>
    </div>
  );
};
