'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CloudOff,
  Download,
  Globe,
  PanelLeftOpen,
  ScrollText,
  SearchX,
  WrapText,
} from 'lucide-react';

import type {
  LogLevelFilter,
  LogRange,
  ProjectLogEntry,
  ProjectLogHistogram,
} from '@acceleratio/shared';
import type { LogFilterQuery, LogWindowQuery } from '@/api/logs';
import { cn } from '@/lib/utils';
import {
  assignSeriesTones,
  type ChartTone,
} from '@/modules/observability/utils/series';
import { useProject } from '@/modules/projects/providers/project-provider';
import { useTerminal } from '@/modules/terminal/providers/terminal-provider';
import { isContainerWorkload } from '@/modules/workloads/utils/workload-capabilities';
import { LogList } from '../components/log-list';
import type { LogRowActions } from '../components/log-row';
import { LogsHistogram } from '../components/logs-histogram';
import { LogsMessage } from '../components/logs-message';
import { LogsSearch, type FilterChip } from '../components/logs-search';
import { LogsSidebar } from '../components/logs-sidebar';
import { LogsToolbar } from '../components/logs-toolbar';
import { useLogHistory } from '../hooks/use-log-history';
import { useLogOverview } from '../hooks/use-log-overview';
import { useLogStream } from '../hooks/use-log-stream';
import {
  LOG_LEVEL_FILTERS,
  LOGS_POD_PARAM,
  LOGS_SERVICE_PARAM,
  MAX_BUFFERED_LINES,
  RANGE_LABELS,
} from '../utils/constants';
import { toLogFile } from '../utils/entries';
import { setLogsTargetParams } from '../utils/links';
import { formatExactCount, formatWindow, logTimeMs } from '../utils/format';
import { LEVEL_STYLES } from '../utils/level';

const SEARCH_DEBOUNCE_MS = 300;

const toggleIn = <T,>(set: ReadonlySet<T>, value: T, only?: boolean) => {
  if (only) {
    return new Set([value]);
  }

  const next = new Set(set);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
};

/** The histogram with only `levels` counted, for the chart and its total. */
const onlyLevels = (
  histogram: ProjectLogHistogram,
  levels: ReadonlySet<LogLevelFilter>,
): ProjectLogHistogram => {
  let total = 0;
  const buckets = histogram.buckets.map((bucket) => {
    const next = { ...bucket };

    for (const level of LOG_LEVEL_FILTERS) {
      if (levels.has(level)) {
        total += bucket[level];
      } else {
        next[level] = 0;
      }
    }

    return next;
  });

  return { ...histogram, buckets, total };
};

/** `?service=` and `?pod=` hold the selection as a comma-separated list. */
const setOf = (value: string | null | undefined) =>
  new Set<string>(value ? value.split(',') : []);
const listOf = (values: ReadonlySet<string>) => [...values].join(',');

/**
 * The Logs tab: every service of the project in one stream, ordered by time,
 * narrowed by service, pod, level and text. Live mode follows new lines
 * from the log store, so deploys and restarts never cut it. The tab only
 * loads and streams while `active`.
 */
export const LogsView = ({ active }: { active: boolean }) => {
  const { project, workloads, isLoadingWorkloads } = useProject();
  const terminal = useTerminal();
  const searchParams = useSearchParams();
  const urlService = searchParams.get(LOGS_SERVICE_PARAM);
  const urlPod = searchParams.get(LOGS_POD_PARAM);

  const [range, setRange] = useState<LogRange>('1h');
  const [customWindow, setCustomWindow] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [live, setLive] = useState(true);
  const [levels, setLevels] = useState<ReadonlySet<LogLevelFilter>>(
    () => new Set(),
  );
  const [workloadIds, setWorkloadIds] = useState<ReadonlySet<string>>(() =>
    setOf(urlService),
  );
  const [pods, setPods] = useState<ReadonlySet<string>>(() => setOf(urlPod));
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [wrap, setWrap] = useState(false);
  const [utc, setUtc] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pending, setPending] = useState<ProjectLogEntry[]>([]);
  const [dropped, setDropped] = useState(0);
  const atTop = useRef(true);
  const searchRef = useRef<HTMLInputElement>(null);

  // A link such as "View logs" on a service rewrites `?service=`/`?pod=`; one
  // that differs from the current filter applies it. This is the "adjust state
  // while rendering" pattern. The effect below mirrors the filter into the URL,
  // so that write matches the state and changes nothing.
  const linkKey = `${urlService ?? ''}|${urlPod ?? ''}`;
  const [lastLinkKey, setLastLinkKey] = useState(linkKey);

  if (linkKey !== lastLinkKey) {
    setLastLinkKey(linkKey);

    if (
      (urlService || urlPod) &&
      linkKey !== `${listOf(workloadIds)}|${listOf(pods)}`
    ) {
      setWorkloadIds(setOf(urlService));
      setPods(setOf(urlPod));
      setLevels(new Set());
    }
  }

  // The visible tab keeps the URL in step with its filter, so a reload or a
  // copied link opens the same logs, and a cleared filter leaves no stale query.
  useEffect(() => {
    if (!active) {
      return;
    }

    const url = new URL(window.location.href);

    setLogsTargetParams(url.searchParams, {
      service: listOf(workloadIds),
      pod: listOf(pods),
    });

    if (url.href !== window.location.href) {
      window.history.replaceState(null, '', url);
    }
  }, [active, workloadIds, pods]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearch(searchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const timeWindow = useMemo<LogWindowQuery>(
    () => customWindow ?? { range },
    [customWindow, range],
  );
  const filters = useMemo<LogFilterQuery>(
    () => ({
      workloadIds: [...workloadIds].sort(),
      pods: [...pods].sort(),
      levels: LOG_LEVEL_FILTERS.filter((level) => levels.has(level)),
      search,
    }),
    [workloadIds, pods, levels, search],
  );

  // Lines held back for the old query must not land in the new one.
  const queryKey = JSON.stringify([timeWindow, filters]);
  const [lastQueryKey, setLastQueryKey] = useState(queryKey);

  if (queryKey !== lastQueryKey) {
    setLastQueryKey(queryKey);
    setPending([]);
    setDropped(0);
  }

  // The chart is read without the level filter: the sidebar needs every
  // level's count to offer it, and the chart hides unselected levels itself.
  const overviewFilters = useMemo<LogFilterQuery>(
    () => ({ ...filters, levels: [] }),
    [filters],
  );

  const history = useLogHistory(project.id, timeWindow, filters, active);
  const overview = useLogOverview(
    project.id,
    timeWindow,
    overviewFilters,
    active,
    live && !customWindow,
  );
  const { prepend } = history;

  // The newest line received for this query, shown or held back; a
  // reconnecting stream resumes right after it.
  const newest = useRef<string | null>(null);
  const advanceNewest = (time: string | undefined) => {
    if (
      time &&
      (!newest.current || logTimeMs(time) > logTimeMs(newest.current))
    ) {
      newest.current = time;
    }
  };

  useEffect(() => {
    newest.current = null;
  }, [queryKey]);

  useEffect(() => {
    advanceNewest(history.entries[0]?.time);
  }, [history.entries]);

  const onEntries = useCallback(
    (incoming: ProjectLogEntry[]) => {
      if (atTop.current) {
        prepend(incoming);
      } else {
        setPending((previous) =>
          [...previous, ...incoming].slice(-MAX_BUFFERED_LINES),
        );
      }

      advanceNewest(incoming[incoming.length - 1]?.time);
    },
    [prepend],
  );

  const stream = useLogStream({
    projectId: project.id,
    filters,
    enabled:
      active &&
      live &&
      !customWindow &&
      !history.isLoading &&
      !history.error?.unavailable,
    since: () => newest.current,
    onEntries,
    onDropped: (count) => setDropped((previous) => previous + count),
  });

  const showPending = useCallback(() => {
    setPending((held) => {
      if (held.length > 0) {
        prepend(held);
      }

      return [];
    });
  }, [prepend]);

  const handleAtTopChange = useCallback(
    (next: boolean) => {
      atTop.current = next;

      if (next) {
        showPending();
      }
    },
    [showPending],
  );

  // `/` jumps to search from anywhere in the tab, as in most log viewers.
  useEffect(() => {
    if (!active) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');

      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKey);

    return () => document.removeEventListener('keydown', handleKey);
  }, [active]);

  const tones = useMemo(
    () => assignSeriesTones(workloads.map((workload) => workload.id)),
    [workloads],
  );
  const names = useMemo(() => {
    const map = new Map<string, string>();

    for (const workload of overview.sources?.workloads ?? []) {
      if (workload.name) {
        map.set(workload.workload_id, workload.name);
      }
    }

    for (const workload of workloads) {
      map.set(workload.id, workload.name);
    }

    return map;
  }, [workloads, overview.sources]);

  const serviceName = useCallback(
    (id: string | null) => {
      if (id === null) {
        return 'Unlabelled';
      }

      // Until the services load, an unknown id is not yet a deleted one.
      return names.get(id) ?? (isLoadingWorkloads ? '…' : 'Deleted service');
    },
    [names, isLoadingWorkloads],
  );
  const toneOf = useCallback(
    (id: string | null): ChartTone => (id && tones.get(id)) || 'other',
    [tones],
  );

  const livePods = useMemo(
    () =>
      new Set(
        (overview.sources?.workloads ?? []).flatMap((workload) =>
          workload.pods.filter((pod) => pod.live).map((pod) => pod.name),
        ),
      ),
    [overview.sources],
  );

  const levelCounts = useMemo(() => {
    if (!overview.histogram) {
      return null;
    }

    const counts = { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 };

    for (const bucket of overview.histogram.buckets) {
      for (const level of LOG_LEVEL_FILTERS) {
        counts[level] += bucket[level];
      }
    }

    return counts;
  }, [overview.histogram]);

  const histogram = useMemo(
    () =>
      overview.histogram && levels.size > 0
        ? onlyLevels(overview.histogram, levels)
        : overview.histogram,
    [overview.histogram, levels],
  );

  const toggleWorkload = useCallback(
    (id: string, only?: boolean) => {
      const next = toggleIn(workloadIds, id, only);

      setWorkloadIds(next);

      // Pods of a service that is no longer selected would filter out
      // everything, so they go with it. Without the pod list yet there is
      // nothing to tell them apart, so the selection stays.
      if (!overview.sources) {
        return;
      }

      const allowed = new Set(
        overview.sources.workloads
          .filter(
            (workload) => next.size === 0 || next.has(workload.workload_id),
          )
          .flatMap((workload) => workload.pods.map((pod) => pod.name)),
      );

      setPods(
        (previous) => new Set([...previous].filter((pod) => allowed.has(pod))),
      );
    },
    [workloadIds, overview.sources],
  );

  const clearFilters = useCallback(() => {
    setLevels(new Set());
    setWorkloadIds(new Set());
    setPods(new Set());
    setSearchInput('');
    setSearch('');
  }, []);

  const actions = useMemo<LogRowActions>(
    () => ({
      onFilterService: (id) => {
        setWorkloadIds(new Set([id]));
        setPods(new Set());
      },
      onFilterPod: (pod) => setPods(new Set([pod])),
      onOpenTerminal: terminal.canOpen
        ? (entry) => {
            if (entry.workload_id) {
              terminal.openTerminal({
                projectId: project.id,
                workloadId: entry.workload_id,
                workloadName: serviceName(entry.workload_id),
                pod: entry.pod,
              });
            }
          }
        : null,
      isPodLive: (pod) => livePods.has(pod),
    }),
    [terminal, livePods, project.id, serviceName],
  );

  const chips: FilterChip[] = [
    ...LOG_LEVEL_FILTERS.filter((level) => levels.has(level)).map((level) => ({
      key: `level:${level}`,
      label: 'Level',
      value: LEVEL_STYLES[level].label,
      onRemove: () => setLevels(toggleIn(levels, level)),
    })),
    ...[...workloadIds].map((id) => ({
      key: `service:${id}`,
      label: 'Service',
      value: serviceName(id),
      onRemove: () => toggleWorkload(id),
    })),
    ...[...pods].map((pod) => ({
      key: `pod:${pod}`,
      label: 'Pod',
      value: pod,
      onRemove: () => setPods(toggleIn(pods, pod)),
    })),
  ];
  const hasFilters = chips.length > 0 || search !== '';

  const selectRange = (next: LogRange) => {
    setRange(next);
    setCustomWindow(null);
  };

  const changeLive = (next: boolean) => {
    setLive(next);

    if (next) {
      setCustomWindow(null);
    }
  };

  const zoom = (start: number, end: number) => {
    setCustomWindow({
      start: new Date(start * 1000).toISOString(),
      end: new Date(Math.min(end * 1000, Date.now())).toISOString(),
    });
    setLive(false);
  };

  const refresh = () => {
    setPending([]);
    void history.reload();
    overview.refresh();
  };

  const download = () => {
    const blob = new Blob([toLogFile(history.entries, serviceName)], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${project.name}-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    link.click();
    // The download reads the blob after this handler returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const windowLabel = customWindow
    ? formatWindow(customWindow.start, customWindow.end)
    : RANGE_LABELS[range].toLowerCase();
  const isLive = live && !customWindow;
  const dockerCount = workloads.filter((w) =>
    isContainerWorkload(w.type),
  ).length;

  let body;

  if (history.error?.unavailable) {
    body = (
      <LogsMessage
        icon={
          <CloudOff aria-hidden="true" strokeWidth={1.75} className="size-5" />
        }
        title="Log storage unavailable"
        message={history.error.message}
        onRetry={refresh}
      >
        <div className="w-full rounded-lg border border-edge-subtle bg-surface-sunken p-3 text-left text-xs text-fg-secondary">
          <p>
            Logs are stored in VictoriaLogs in the{' '}
            <span className="font-mono">victoria-logs</span> namespace, and
            Vector collects them from every project. Install both with:
          </p>
          <ul className="mt-2 flex flex-col gap-1 font-mono text-fg-primary">
            <li>sudo ./scripts/install.sh</li>
          </ul>
        </div>
      </LogsMessage>
    );
  } else if (history.error && history.entries.length === 0) {
    body = (
      <LogsMessage
        icon={
          <CloudOff aria-hidden="true" strokeWidth={1.75} className="size-5" />
        }
        title="Could not load logs"
        message={history.error.message}
        onRetry={refresh}
      />
    );
  } else if (history.isLoading && history.entries.length === 0) {
    body = <ListSkeleton />;
  } else if (history.entries.length === 0 && dockerCount === 0) {
    body = (
      <LogsMessage
        icon={
          <ScrollText
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-5"
          />
        }
        title="No services yet"
        message="Deploy a service from the Architecture tab. Everything it writes to stdout and stderr shows up here."
      />
    );
  } else if (history.entries.length === 0 && hasFilters) {
    body = (
      <LogsMessage
        icon={
          <SearchX aria-hidden="true" strokeWidth={1.75} className="size-5" />
        }
        title="No lines match"
        message={`Nothing in the ${windowLabel} matches these filters.`}
        action={{ label: 'Clear filters', onClick: clearFilters }}
      />
    );
  } else if (history.entries.length === 0) {
    body = (
      <LogsMessage
        icon={
          <ScrollText
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-5"
          />
        }
        title={isLive ? 'Waiting for new lines' : 'No logs in this window'}
        message={
          isLive
            ? `Nothing was logged in the ${windowLabel}. New lines appear here a few seconds after a service writes them.`
            : `Nothing was logged in the ${windowLabel}. Try a longer range.`
        }
      />
    );
  } else {
    body = (
      <LogList
        entries={history.entries}
        wrap={wrap}
        utc={utc}
        search={search}
        hasOlder={history.nextCursor !== null}
        isLoadingOlder={history.isLoadingMore}
        endLabel={`Start of the ${windowLabel}`}
        pending={pending.length}
        serviceName={serviceName}
        toneOf={toneOf}
        actions={actions}
        onLoadOlder={() => void history.loadOlder()}
        onAtTopChange={handleAtTopChange}
        onShowPending={showPending}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
      <div className="flex shrink-0 justify-end pt-16 lg:pt-3">
        <LogsToolbar
          range={customWindow ? null : range}
          customWindow={customWindow}
          onRangeChange={selectRange}
          live={isLive}
          liveStatus={stream.status}
          onLiveChange={changeLive}
          isLoading={history.isLoading}
          onRefresh={refresh}
        />
      </div>

      <section
        aria-label="Project logs"
        className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-edge-default bg-surface-raised shadow-panel"
      >
        {sidebarOpen ? (
          <>
            {/* Narrow screens: the filters cover the list until closed. */}
            <div
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 z-10 bg-scrim/20 md:hidden"
            />
            <div className="absolute inset-y-0 left-0 z-20 shadow-float md:static md:shadow-none">
              <LogsSidebar
                sources={overview.sources}
                levelCounts={levelCounts}
                levels={levels}
                workloadIds={workloadIds}
                pods={pods}
                tones={tones}
                serviceName={serviceName}
                onToggleLevel={(level, only) =>
                  setLevels(toggleIn(levels, level, only))
                }
                onToggleWorkload={toggleWorkload}
                onTogglePod={(pod, only) => setPods(toggleIn(pods, pod, only))}
                onClear={clearFilters}
                onCollapse={() => setSidebarOpen(false)}
              />
            </div>
          </>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-start gap-2 border-b border-edge-subtle px-3 py-2">
            {!sidebarOpen ? (
              <ToolButton
                label="Show filters"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeftOpen aria-hidden="true" strokeWidth={1.75} />
              </ToolButton>
            ) : null}
            <LogsSearch
              ref={searchRef}
              value={searchInput}
              onChange={setSearchInput}
              onSubmit={() => setSearch(searchInput.trim())}
              chips={chips}
            />
          </div>

          <div className="shrink-0 border-b border-edge-subtle px-3 pt-2.5 pb-1.5">
            <div className="mb-1 flex items-baseline gap-2 text-xs">
              <span className="font-medium text-fg-primary tabular-nums">
                {histogram
                  ? `${formatExactCount(histogram.total)} lines`
                  : 'Counting lines'}
              </span>
              <span className="text-fg-tertiary">{windowLabel}</span>
              <span className="ml-auto hidden text-[11px] text-fg-tertiary md:inline">
                Drag across the chart to zoom in
              </span>
            </div>
            <LogsHistogram histogram={histogram} onZoom={zoom} />
          </div>

          <div className="flex h-9 shrink-0 items-center gap-3 border-b border-edge-subtle bg-surface-panel pr-1.5 pl-3 text-[11px] font-medium tracking-wide text-fg-tertiary uppercase">
            <span className="w-36 shrink-0">Time</span>
            <span className="w-7 shrink-0">Lvl</span>
            <span className="w-32 shrink-0">Service</span>
            <span className="hidden w-24 shrink-0 xl:block">Pod</span>
            <span className="min-w-0 flex-1">Message</span>
            <div className="flex items-center gap-0.5 normal-case">
              <ToolButton
                label={wrap ? 'Truncate long lines' : 'Wrap long lines'}
                pressed={wrap}
                onClick={() => setWrap(!wrap)}
              >
                <WrapText aria-hidden="true" strokeWidth={1.75} />
              </ToolButton>
              <ToolButton
                label={utc ? 'Show local time' : 'Show UTC time'}
                pressed={utc}
                onClick={() => setUtc(!utc)}
              >
                <Globe aria-hidden="true" strokeWidth={1.75} />
              </ToolButton>
              <ToolButton
                label="Download the loaded lines"
                disabled={history.entries.length === 0}
                onClick={download}
              >
                <Download aria-hidden="true" strokeWidth={1.75} />
              </ToolButton>
            </div>
          </div>

          {history.error && history.entries.length > 0 ? (
            <p
              role="status"
              className="shrink-0 border-b border-status-warning/20 bg-status-warning/5 px-3 py-1.5 text-xs text-status-warning"
            >
              Showing the lines already loaded. {history.error.message}
            </p>
          ) : null}
          {isLive && (stream.error || dropped > 0) ? (
            <p
              role="status"
              className="shrink-0 border-b border-edge-subtle bg-surface-sunken px-3 py-1.5 text-xs text-fg-secondary"
            >
              {stream.error
                ? `Live view interrupted: ${stream.error}. Reconnecting…`
                : `Live view skipped ${formatExactCount(dropped)} lines to keep up. Pause live mode or narrow the filters to read every line.`}
            </p>
          ) : null}

          <div
            aria-busy={history.isLoading}
            className="flex min-h-0 flex-1 flex-col"
          >
            <span className="sr-only">
              {history.isLoading ? 'Loading logs' : 'Logs loaded'}
            </span>
            {body}
          </div>
        </div>
      </section>
    </div>
  );
};

const ToolButton = ({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/60 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4',
      pressed
        ? 'bg-surface-muted text-fg-primary'
        : 'text-fg-tertiary hover:bg-surface-muted hover:text-fg-primary',
    )}
  >
    {children}
  </button>
);

const ListSkeleton = () => (
  <div aria-hidden="true" className="flex flex-col gap-2.5 px-3 py-3">
    {Array.from({ length: 14 }, (_, index) => (
      <div key={index} className="flex items-center gap-3">
        <span className="h-3 w-36 animate-[delayed-in_150ms_200ms_both] rounded-sm bg-surface-muted motion-reduce:animate-none" />
        <span className="h-3 w-7 animate-[delayed-in_150ms_200ms_both] rounded-sm bg-surface-muted motion-reduce:animate-none" />
        <span className="h-3 w-32 animate-[delayed-in_150ms_200ms_both] rounded-sm bg-surface-muted motion-reduce:animate-none" />
        <span
          className={cn(
            'h-3 animate-[delayed-in_150ms_200ms_both] rounded-sm bg-surface-muted motion-reduce:animate-none',
            index % 3 === 0 ? 'w-1/2' : index % 3 === 1 ? 'w-2/3' : 'w-1/3',
          )}
        />
      </div>
    ))}
  </div>
);
