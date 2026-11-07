'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, LoaderCircle } from 'lucide-react';

import type { ProjectLogEntry } from '@acceleratio/shared';
import type { ChartTone } from '@/modules/observability/utils/series';
import { LogRow, type LogRowActions } from './log-row';

/** A single-line row; wrapped and expanded rows are measured. */
const ROW_ESTIMATE_PX = 25;

/** Start loading the next older page this many rows before the end. */
const LOAD_AHEAD_ROWS = 40;

type LogListProps = {
  entries: ProjectLogEntry[];
  wrap: boolean;
  utc: boolean;
  search: string;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  /** The list reached the start of the window. */
  endLabel: string;
  /** Live lines held back while the reader is scrolled away from the top. */
  pending: number;
  serviceName: (id: string | null) => string;
  toneOf: (id: string | null) => ChartTone;
  actions: LogRowActions;
  onLoadOlder: () => void;
  onAtTopChange: (atTop: boolean) => void;
  onShowPending: () => void;
};

/**
 * The line list, newest first and virtualized so thousands of lines scroll
 * smoothly. New live lines land on top while the reader is there; once they
 * scroll down, lines wait behind a "new lines" button instead of shifting
 * the text they are reading. Arrow keys move between lines, Enter opens one.
 */
export const LogList = ({
  entries,
  wrap,
  utc,
  search,
  hasOlder,
  isLoadingOlder,
  endLabel,
  pending,
  serviceName,
  toneOf,
  actions,
  onLoadOlder,
  onAtTopChange,
  onShowPending,
}: LogListProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const atTop = useRef(true);
  const reportAtTop = useRef(onAtTopChange);

  useEffect(() => {
    reportAtTop.current = onAtTopChange;
  });

  // A fresh list starts scrolled to the top; say so, or a parent that saw
  // the previous list scrolled down would keep holding live lines back.
  useEffect(() => {
    reportAtTop.current(true);
  }, []);

  // The virtualizer hands back functions the React Compiler cannot memoize;
  // that is expected for this library.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 12,
    getItemKey: (index) => entries[index]?.id ?? index,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length > 0 ? items[items.length - 1].index : -1;

  // Wrapping changes every row height.
  useEffect(() => {
    virtualizer.measure();
  }, [wrap, virtualizer]);

  useEffect(() => {
    if (
      hasOlder &&
      !isLoadingOlder &&
      lastIndex >= entries.length - LOAD_AHEAD_ROWS
    ) {
      onLoadOlder();
    }
  }, [lastIndex, entries.length, hasOlder, isLoadingOlder, onLoadOlder]);

  const handleScroll = () => {
    const next = (scrollRef.current?.scrollTop ?? 0) < 4;

    if (next !== atTop.current) {
      atTop.current = next;
      onAtTopChange(next);
    }
  };

  const toggle = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }, []);

  const focusRow = (index: number) => {
    const target = Math.max(0, Math.min(entries.length - 1, index));

    setFocusedIndex(target);
    virtualizer.scrollToIndex(target, { align: 'auto' });
    window.requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-row-index="${target}"]`)
        ?.focus({ preventScroll: true });
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowDown: focusedIndex + 1,
      ArrowUp: focusedIndex - 1,
      PageDown: focusedIndex + 20,
      PageUp: focusedIndex - 20,
      Home: 0,
      End: entries.length - 1,
    };
    const target = moves[event.key];

    if (target !== undefined && entries.length > 0) {
      event.preventDefault();
      focusRow(target);
    }
  };

  const showPending = () => {
    onShowPending();
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const safeFocused = Math.min(focusedIndex, Math.max(0, entries.length - 1));

  return (
    <div className="relative min-h-0 flex-1">
      {pending > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <button
            type="button"
            onClick={showPending}
            className="pointer-events-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3 text-xs font-medium text-fg-on-brand shadow-float outline-none hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowUp
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5"
            />
            {pending === 1
              ? '1 new line'
              : `${pending.toLocaleString()} new lines`}
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        role="log"
        aria-label="Log lines, newest first"
        aria-live="off"
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        className="absolute inset-0 overflow-auto overscroll-contain font-mono text-xs leading-[17px]"
      >
        {/* The virtualizer positions rows by measured offsets, which only an
            inline size and transform can express. */}
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((item) => {
            const entry = entries[item.index];

            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <LogRow
                  entry={entry}
                  index={item.index}
                  expanded={expanded.has(entry.id)}
                  focused={item.index === safeFocused}
                  wrap={wrap}
                  utc={utc}
                  search={search}
                  serviceName={serviceName(entry.workload_id)}
                  tone={toneOf(entry.workload_id)}
                  actions={actions}
                  onToggle={toggle}
                  onFocusRow={setFocusedIndex}
                />
              </div>
            );
          })}
        </div>

        <div className="flex h-10 items-center justify-center gap-2 font-sans text-xs text-fg-tertiary">
          {isLoadingOlder ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              Loading older lines
            </>
          ) : hasOlder ? (
            <button
              type="button"
              onClick={onLoadOlder}
              className="cursor-pointer rounded-sm px-1 text-brand-fg outline-none hover:underline focus-visible:ring-2 focus-visible:ring-foreground/60"
            >
              Load older lines
            </button>
          ) : (
            endLabel
          )}
        </div>
      </div>
    </div>
  );
};
