'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, PanelLeftClose, Search } from 'lucide-react';

import type {
  LogLevelFilter,
  LogSourcePod,
  ProjectLogSources,
} from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { TONE_BG, type ChartTone } from '@/modules/observability/utils/series';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { LOG_LEVEL_FILTERS } from '../utils/constants';
import { formatCount, shortPodName } from '../utils/format';
import { LEVEL_STYLES } from '../utils/level';

/** Long lists get a filter box. */
const SEARCHABLE_AFTER = 8;

type LogsSidebarProps = {
  sources: ProjectLogSources | null;
  /** Lines per level in the window, from the chart. */
  levelCounts: Record<LogLevelFilter, number> | null;
  levels: ReadonlySet<LogLevelFilter>;
  workloadIds: ReadonlySet<string>;
  pods: ReadonlySet<string>;
  tones: Map<string, ChartTone>;
  serviceName: (id: string | null) => string;
  onToggleLevel: (level: LogLevelFilter, only?: boolean) => void;
  onToggleWorkload: (id: string, only?: boolean) => void;
  onTogglePod: (pod: string, only?: boolean) => void;
  onClear: () => void;
  onCollapse: () => void;
};

/**
 * Facets to narrow the stream, one section each for level, service and pod.
 * Values within a section are OR-ed, sections are AND-ed. The pod list
 * follows the selected services.
 */
export const LogsSidebar = ({
  sources,
  levelCounts,
  levels,
  workloadIds,
  pods,
  tones,
  serviceName,
  onToggleLevel,
  onToggleWorkload,
  onTogglePod,
  onClear,
  onCollapse,
}: LogsSidebarProps) => {
  const [serviceQuery, setServiceQuery] = useState('');
  const [podQuery, setPodQuery] = useState('');
  const hasFilters = levels.size + workloadIds.size + pods.size > 0;
  const workloads = useMemo(() => sources?.workloads ?? [], [sources]);

  const visibleWorkloads = workloads.filter((workload) =>
    serviceName(workload.workload_id)
      .toLowerCase()
      .includes(serviceQuery.trim().toLowerCase()),
  );

  const podGroups = useMemo(
    () =>
      workloads
        .filter(
          (workload) =>
            workloadIds.size === 0 || workloadIds.has(workload.workload_id),
        )
        .map((workload) => ({
          workload,
          pods: workload.pods.filter((pod) =>
            pod.name.includes(podQuery.trim().toLowerCase()),
          ),
        }))
        .filter((group) => group.pods.length > 0),
    [workloads, workloadIds, podQuery],
  );
  const podCount = workloads.reduce(
    (sum, workload) => sum + workload.pods.length,
    0,
  );

  return (
    <aside
      aria-label="Log filters"
      className="flex h-full w-64 shrink-0 flex-col border-r border-edge-subtle bg-surface-panel"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge-subtle pr-1.5 pl-3">
        <h2 className="text-[13px] font-medium tracking-tight text-fg-primary">
          Filters
        </h2>
        {hasFilters ? (
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer rounded-sm px-1 text-xs text-brand-fg outline-none hover:underline focus-visible:ring-2 focus-visible:ring-foreground/60"
          >
            Clear all
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide filters"
          title="Hide filters"
          className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-tertiary outline-none hover:bg-surface-muted hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-foreground/60"
        >
          <PanelLeftClose
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-4"
          />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <FacetSection title="Level" selected={levels.size}>
          {LOG_LEVEL_FILTERS.map((level) => (
            <FacetRow
              key={level}
              checked={levels.has(level)}
              onToggle={(only) => onToggleLevel(level, only)}
              marker={
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-3 w-0.75 shrink-0 rounded-full',
                    LEVEL_STYLES[level].bg,
                  )}
                />
              }
              label={LEVEL_STYLES[level].label}
              count={levelCounts?.[level] ?? null}
            />
          ))}
        </FacetSection>

        <FacetSection
          title="Services"
          selected={workloadIds.size}
          total={workloads.length}
        >
          {workloads.length > SEARCHABLE_AFTER ? (
            <FacetSearch
              label="Filter services"
              value={serviceQuery}
              onChange={setServiceQuery}
            />
          ) : null}
          {visibleWorkloads.map((workload) => {
            const tone = tones.get(workload.workload_id) ?? 'other';

            return (
              <FacetRow
                key={workload.workload_id}
                checked={workloadIds.has(workload.workload_id)}
                onToggle={(only) =>
                  onToggleWorkload(workload.workload_id, only)
                }
                marker={
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      TONE_BG[tone],
                    )}
                  />
                }
                label={serviceName(workload.workload_id)}
                muted={workload.name === null}
                count={workload.lines}
              />
            );
          })}
          {sources && workloads.length === 0 ? (
            <FacetEmpty>No services in this project yet.</FacetEmpty>
          ) : null}
          {!sources ? <FacetSkeleton rows={3} /> : null}
        </FacetSection>

        <FacetSection
          title="Pods"
          selected={pods.size}
          total={podCount}
          defaultOpen={podCount <= 12}
        >
          {podCount > SEARCHABLE_AFTER ? (
            <FacetSearch
              label="Filter pods"
              value={podQuery}
              onChange={setPodQuery}
            />
          ) : null}
          {podGroups.map(({ workload, pods: groupPods }) => (
            <div key={workload.workload_id} className="flex flex-col">
              {podGroups.length > 1 ? (
                <p className="truncate px-3 pt-2 pb-0.5 text-[11px] font-medium text-fg-tertiary">
                  {serviceName(workload.workload_id)}
                </p>
              ) : null}
              {groupPods.map((pod) => (
                <FacetRow
                  key={pod.name}
                  checked={pods.has(pod.name)}
                  onToggle={(only) => onTogglePod(pod.name, only)}
                  marker={<PodState pod={pod} />}
                  label={shortPodName(pod.name)}
                  title={pod.name}
                  mono
                  muted={!pod.live}
                  count={pod.lines}
                />
              ))}
            </div>
          ))}
          {sources && podGroups.length === 0 ? (
            <FacetEmpty>
              {workloadIds.size > 0
                ? 'The selected services have no pods in this window.'
                : 'No pods in this window.'}
            </FacetEmpty>
          ) : null}
        </FacetSection>
      </div>
    </aside>
  );
};

const PodState = ({ pod }: { pod: LogSourcePod }) => (
  <span
    aria-label={pod.live ? 'Running' : 'Ended'}
    title={pod.live ? 'Running' : 'Ended: logs kept after the pod was removed'}
    className={cn(
      'size-1.5 shrink-0 rounded-full',
      pod.live ? 'bg-status-success' : 'border border-fg-tertiary',
    )}
  />
);

const FacetSection = ({
  title,
  selected,
  total,
  defaultOpen = true,
  children,
}: {
  title: string;
  selected: number;
  total?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className="border-b border-edge-subtle py-1.5 last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
          className="flex h-8 w-full cursor-pointer items-center gap-1.5 px-3 text-left text-xs font-medium text-fg-secondary outline-none hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-foreground/60 focus-visible:ring-inset"
        >
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'size-3.5 shrink-0 text-fg-tertiary transition-transform duration-150 motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
          {title}
          {selected > 0 ? (
            <span className="rounded-sm bg-surface-muted px-1 font-mono text-[11px] text-fg-primary tabular-nums">
              {selected}
            </span>
          ) : total !== undefined ? (
            <span className="font-mono text-[11px] font-normal text-fg-tertiary tabular-nums">
              {total}
            </span>
          ) : null}
        </button>
      </h3>
      <div id={contentId} hidden={!open} className="flex flex-col">
        {children}
      </div>
    </section>
  );
};

const FacetRow = ({
  checked,
  onToggle,
  marker,
  label,
  title,
  count,
  mono = false,
  muted = false,
}: {
  checked: boolean;
  /** `only` selects this value alone. */
  onToggle: (only?: boolean) => void;
  marker: ReactNode;
  label: string;
  title?: string;
  count: number | null;
  mono?: boolean;
  muted?: boolean;
}) => (
  <div className="group/facet relative flex h-7 items-center px-3 hover:bg-surface-muted/70">
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={() => onToggle()}
        className="size-3.5 rounded-[3px] bg-surface-raised"
      />
      {marker}
      <span
        title={title ?? label}
        className={cn(
          'min-w-0 flex-1 truncate text-[13px]',
          mono && 'font-mono text-xs',
          muted ? 'text-fg-tertiary' : 'text-fg-primary',
        )}
      >
        {label}
      </span>
    </label>
    <span className="ml-2 font-mono text-[11px] text-fg-tertiary tabular-nums group-focus-within/facet:hidden group-hover/facet:hidden">
      {count === null ? '' : formatCount(count)}
    </span>
    <button
      type="button"
      onClick={() => onToggle(true)}
      className="ml-2 hidden cursor-pointer rounded-sm px-1 text-[11px] font-medium text-brand-fg outline-none group-focus-within/facet:block group-hover/facet:block hover:underline focus-visible:ring-2 focus-visible:ring-foreground/60"
      aria-label={`Show only ${title ?? label}`}
    >
      Only
    </button>
  </div>
);

const FacetSearch = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <div className="relative mx-3 mb-1">
    <Search
      aria-hidden="true"
      strokeWidth={1.75}
      className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-tertiary"
    />
    <input
      type="search"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 w-full rounded-sm border border-edge-default bg-surface-raised pr-2 pl-7 text-xs text-fg-primary outline-none placeholder:text-fg-tertiary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
    />
  </div>
);

const FacetEmpty = ({ children }: { children: ReactNode }) => (
  <p className="px-3 py-1.5 text-xs text-fg-tertiary">{children}</p>
);

const SKELETON_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3'];

const FacetSkeleton = ({ rows }: { rows: number }) => (
  <div aria-hidden="true" className="flex flex-col gap-2 px-3 py-1.5">
    {Array.from({ length: rows }, (_, index) => (
      <span
        key={index}
        className={cn(
          'h-3.5 animate-[delayed-in_150ms_200ms_both] rounded-sm bg-surface-muted motion-reduce:animate-none',
          SKELETON_WIDTHS[index % SKELETON_WIDTHS.length],
        )}
      />
    ))}
  </div>
);
