'use client';

import { memo, useState } from 'react';
import { Check, Copy, Filter, SquareTerminal } from 'lucide-react';

import type { ProjectLogEntry } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { TONE_BG, type ChartTone } from '@/modules/observability/utils/series';
import {
  formatLogTime,
  logTimeMs,
  prettyMessage,
  shortPodName,
} from '../utils/format';
import { splitMatches } from '../utils/highlight';
import { LEVEL_STYLES, levelKey } from '../utils/level';

export type LogRowActions = {
  onFilterService: (id: string) => void;
  onFilterPod: (pod: string) => void;
  /** Null while the terminal dock has no free tab. */
  onOpenTerminal: ((entry: ProjectLogEntry) => void) | null;
  /** A shell only opens on a pod that still runs. */
  isPodLive: (pod: string) => boolean;
};

type LogRowProps = {
  entry: ProjectLogEntry;
  index: number;
  expanded: boolean;
  focused: boolean;
  wrap: boolean;
  utc: boolean;
  search: string;
  serviceName: string;
  tone: ChartTone;
  actions: LogRowActions;
  onToggle: (id: string) => void;
  onFocusRow: (index: number) => void;
};

/**
 * One log line: a fixed gutter (time, level, service, pod) and the message.
 * Errors and warnings carry a colored edge; the rest stay neutral so the
 * eye lands on what matters. Activating the row shows every field.
 */
export const LogRow = memo(function LogRow({
  entry,
  index,
  expanded,
  focused,
  wrap,
  utc,
  search,
  serviceName,
  tone,
  actions,
  onToggle,
  onFocusRow,
}: LogRowProps) {
  const level = levelKey(entry.level);
  const style = LEVEL_STYLES[level];
  const detailsId = `log-details-${index}`;

  return (
    <div
      className={cn(
        'relative border-b border-edge-subtle/70',
        level === 'error' && 'bg-status-danger/[0.035]',
        level === 'warn' && 'bg-status-warning/[0.035]',
        expanded && 'bg-surface-sunken',
      )}
    >
      {level === 'error' || level === 'warn' ? (
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 left-0 w-0.5', style.bg)}
        />
      ) : null}

      <button
        type="button"
        data-row-index={index}
        tabIndex={focused ? 0 : -1}
        aria-expanded={expanded}
        aria-controls={expanded ? detailsId : undefined}
        onClick={() => onToggle(entry.id)}
        onFocus={() => onFocusRow(index)}
        className={cn(
          'flex w-full cursor-pointer items-start gap-3 py-1 pr-3 pl-3 text-left outline-none',
          'hover:bg-surface-muted/60 focus-visible:bg-surface-muted/80 focus-visible:ring-2 focus-visible:ring-foreground/50 focus-visible:ring-inset',
        )}
      >
        <time
          dateTime={entry.time}
          className="w-36 shrink-0 text-fg-tertiary tabular-nums"
        >
          {formatLogTime(entry.time, utc)}
        </time>
        <span className={cn('w-7 shrink-0 font-medium', style.text)}>
          {style.code}
        </span>
        <span className="flex w-32 shrink-0 items-center gap-1.5 overflow-hidden">
          <span
            aria-hidden="true"
            className={cn('size-1.5 shrink-0 rounded-full', TONE_BG[tone])}
          />
          <span
            className="truncate font-sans text-[12px] text-fg-secondary"
            title={serviceName}
          >
            {serviceName}
          </span>
        </span>
        <span
          className="hidden w-24 shrink-0 truncate text-fg-tertiary xl:block"
          title={entry.pod}
        >
          {shortPodName(entry.pod, serviceName)}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 text-fg-primary',
            wrap ? 'break-all whitespace-pre-wrap' : 'truncate',
          )}
        >
          <Highlighted text={entry.message} search={search} />
        </span>
      </button>

      {expanded ? (
        <LogDetails
          id={detailsId}
          entry={entry}
          serviceName={serviceName}
          utc={utc}
          search={search}
          actions={actions}
        />
      ) : null}
    </div>
  );
});

const Highlighted = ({ text, search }: { text: string; search: string }) => {
  if (!search) {
    return <>{text}</>;
  }

  return (
    <>
      {splitMatches(text, search).map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-[2px] bg-brand-fg/15 text-brand-fg"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
};

const fullTime = (time: string, utc: boolean) => {
  const date = new Date(logTimeMs(time));

  return utc
    ? time
    : `${date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })} · ${time}`;
};

const LogDetails = ({
  id,
  entry,
  serviceName,
  utc,
  search,
  actions,
}: {
  id: string;
  entry: ProjectLogEntry;
  serviceName: string;
  utc: boolean;
  search: string;
  actions: LogRowActions;
}) => {
  const [copied, setCopied] = useState(false);
  const message = prettyMessage(entry.message);
  const fields: [string, string][] = [
    ['Time', fullTime(entry.time, utc)],
    ['Service', serviceName],
    ['Pod', entry.pod],
    ['Container', entry.container],
    ['Stream', entry.stream ?? '—'],
    ['Level', LEVEL_STYLES[levelKey(entry.level)].label],
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entry.message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div id={id} className="flex flex-col gap-3 pr-3 pb-3 pl-3 md:pl-52">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 font-sans text-xs">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-tertiary">{label}</dt>
            <dd className="truncate font-mono text-fg-primary" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <pre className="max-h-80 overflow-auto rounded-md border border-edge-default bg-surface-raised p-2.5 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-fg-primary">
        <Highlighted text={message} search={search} />
      </pre>

      <div className="flex flex-wrap items-center gap-1.5 font-sans">
        <DetailButton onClick={() => void copy()}>
          {copied ? (
            <Check aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <Copy aria-hidden="true" strokeWidth={1.75} />
          )}
          {copied ? 'Copied' : 'Copy message'}
        </DetailButton>
        {entry.workload_id ? (
          <DetailButton
            onClick={() => actions.onFilterService(entry.workload_id!)}
          >
            <Filter aria-hidden="true" strokeWidth={1.75} />
            Only this service
          </DetailButton>
        ) : null}
        <DetailButton onClick={() => actions.onFilterPod(entry.pod)}>
          <Filter aria-hidden="true" strokeWidth={1.75} />
          Only this pod
        </DetailButton>
        {actions.onOpenTerminal &&
        entry.workload_id &&
        actions.isPodLive(entry.pod) ? (
          <DetailButton onClick={() => actions.onOpenTerminal?.(entry)}>
            <SquareTerminal aria-hidden="true" strokeWidth={1.75} />
            Open terminal
          </DetailButton>
        ) : null}
      </div>
    </div>
  );
};

const DetailButton = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-edge-default bg-surface-raised px-2.5 text-xs font-medium text-fg-primary shadow-key-soft outline-none transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-3.5"
  >
    {children}
  </button>
);
