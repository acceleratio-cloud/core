'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, ScrollText } from 'lucide-react';
import type { AuditLogEntry, AuditLogWorkload } from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { auditApi } from '@/api/audit';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
import {
  formatPreciseTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { actionLabel } from '../utils/actions';

const ALL_SERVICES = 'all';

type AuditLogViewProps = {
  /** Loads on first show, so a project opened on another tab costs nothing. */
  active: boolean;
};

/** Every recorded action in the project, newest first. */
export const AuditLogView = ({ active }: AuditLogViewProps) => {
  const { project, workloads } = useProject();
  const [service, setService] = useState(ALL_SERVICES);
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logged, setLogged] = useState<AuditLogWorkload[]>([]);
  // Drops answers of a request a newer one (filter change, refresh) replaced.
  const requestRef = useRef(0);

  /** Fetches a page and applies it, unless a newer request replaced it. */
  const load = useCallback(
    (before?: string) => {
      const request = ++requestRef.current;

      return auditApi
        .list(project.id, {
          before,
          workloadId: service === ALL_SERVICES ? undefined : service,
        })
        .then(
          (page) => {
            if (request !== requestRef.current) {
              return;
            }
            setError(null);
            setEntries((current) =>
              before ? [...(current ?? []), ...page.entries] : page.entries,
            );
            setCursor(page.next_cursor);
          },
          (requestError: unknown) => {
            if (request === requestRef.current) {
              setError(getApiErrorMessage(requestError));
            }
          },
        )
        .finally(() => {
          if (request === requestRef.current) {
            setIsLoading(false);
          }
        });
    },
    [project.id, service],
  );

  useEffect(() => {
    if (active) {
      void load();
    }
  }, [active, load]);

  // Deleted services are only in the log; the filter lists them too.
  useEffect(() => {
    if (!active) {
      return;
    }
    let current = true;
    auditApi
      .workloads(project.id)
      .then((items) => {
        if (current) {
          setLogged(items);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [active, project.id]);

  const reload = (before?: string) => {
    setIsLoading(true);
    void load(before);
  };

  const liveIds = new Set(workloads.map((workload) => workload.id));
  const serviceChoices = [
    { value: ALL_SERVICES, label: 'All services' },
    ...workloads.map((workload) => ({
      value: workload.id,
      label: workload.name,
    })),
    ...logged
      .filter((workload) => !liveIds.has(workload.id))
      .map((workload) => ({
        value: workload.id,
        label: `${workload.name ?? workload.id.slice(0, 8)} (deleted)`,
      })),
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-20 pb-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-foreground">Audit Logs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Who changed what in this project and its services, from where, and
            how it ended.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={service}
            items={serviceChoices}
            onValueChange={(value) => {
              if (typeof value === 'string') {
                setService(value);
                setEntries(null);
                setCursor(null);
                setExpanded(null);
              }
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Filter by service"
              className="w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {serviceChoices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reload()}
            disabled={isLoading}
          >
            <RefreshCw
              data-icon="inline-start"
              aria-hidden="true"
              className={cn(isLoading && 'animate-spin')}
            />
            Refresh
          </Button>
        </div>
      </div>

      {entries === null ? (
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">Loading audit log...</span>
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-11 rounded-md" />
            ))}
          </div>
        )
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <ScrollText
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-5 text-muted-foreground"
          />
          <p className="text-sm font-medium text-foreground">No events yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Deploys, setting changes, revealed secrets and opened terminals
            show here as they happen.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-border bg-surface-raised">
            <table className="w-full min-w-[760px] text-[13px]">
              <caption className="sr-only">Project audit log</caption>
              <thead className="bg-surface-sunken text-left text-[12px] text-muted-foreground">
                <tr>
                  <th scope="col" className="w-8 px-2 py-2">
                    <span className="sr-only">Details</span>
                  </th>
                  <th scope="col" className="w-40 px-3 py-2 font-medium">
                    Time
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Actor
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Action
                  </th>
                  <th scope="col" className="w-36 px-3 py-2 font-medium">
                    IP address
                  </th>
                  <th scope="col" className="w-28 px-3 py-2 font-medium">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    expanded={expanded === entry.id}
                    onToggle={() =>
                      setExpanded((current) =>
                        current === entry.id ? null : entry.id,
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {cursor ? (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => reload(cursor)}
              disabled={isLoading}
            >
              Load older events
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
};

const AuditRow = ({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const detailsId = `audit-entry-${entry.id}`;
  const failed = entry.outcome === 'failure';

  return (
    <Fragment>
      <tr className="align-top hover:bg-surface-sunken">
        <td className="px-2 py-2.5">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`Details of ${actionLabel(entry.action)}`}
            onClick={onToggle}
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                'size-3.5 transition-transform',
                expanded && 'rotate-90',
              )}
            />
          </button>
        </td>
        <td className="px-3 py-2.5">
          <time
            dateTime={entry.created_at}
            title={formatPreciseTime(entry.created_at)}
            className="text-foreground"
          >
            {formatRelativeTime(entry.created_at)}
          </time>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {formatPreciseTime(entry.created_at)}
          </span>
        </td>
        <td className="max-w-56 px-3 py-2.5">
          <span className="block truncate text-foreground">
            {entry.actor_name ?? 'Unknown'}
            {entry.actor_type === 'github' ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                via GitHub push
              </span>
            ) : null}
          </span>
          {entry.actor_email ? (
            <span className="block truncate text-xs text-muted-foreground">
              {entry.actor_email}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2.5">
          <span className="block text-foreground">
            {actionLabel(entry.action)}
          </span>
          <span className="block text-xs text-muted-foreground">
            {entry.workload_name ? `${entry.workload_name} · ` : null}
            <span className="font-mono">{entry.action}</span>
          </span>
        </td>
        <td className="px-3 py-2.5 font-mono text-xs text-foreground tabular-nums">
          {entry.ip_address ?? (
            <span className="font-sans text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <span
            className={cn(
              'block',
              failed ? 'font-medium text-destructive' : 'text-foreground',
            )}
          >
            {failed ? 'Failed' : 'Success'}
          </span>
          {entry.status_code ? (
            <span className="block text-xs text-muted-foreground tabular-nums">
              HTTP {entry.status_code}
            </span>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr id={detailsId} className="bg-surface-sunken">
          <td colSpan={6} className="px-4 py-3">
            <AuditDetails entry={entry} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
};

const AuditDetails = ({ entry }: { entry: AuditLogEntry }) => {
  const rows: [string, string | null][] = [
    ['Event ID', entry.id],
    ['Time (UTC)', entry.created_at],
    ['Action', entry.action],
    ['Actor type', entry.actor_type],
    ['Actor ID', entry.actor_id],
    ['Session ID', entry.session_id],
    ['IP address', entry.ip_address],
    ['User agent', entry.user_agent],
    ['Service', entry.workload_name],
    ['Service ID', entry.workload_id],
    [
      'Request',
      entry.http_method
        ? `${entry.http_method} ${entry.http_path ?? ''}`
        : null,
    ],
    ['Status', entry.status_code ? String(entry.status_code) : null],
    [
      'Duration',
      entry.duration_ms === null ? null : `${entry.duration_ms} ms`,
    ],
    ['Error', entry.error],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd
                className={cn(
                  'font-mono break-all text-foreground',
                  label === 'Error' && 'text-destructive',
                )}
              >
                {value}
              </dd>
            </Fragment>
          ))}
      </dl>
      {Object.keys(entry.metadata).length > 0 ? (
        <div className="min-w-0">
          <p className="mb-1.5 text-xs text-muted-foreground">
            Details (secrets redacted)
          </p>
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface-raised p-3 font-mono text-xs text-foreground">
            {JSON.stringify(entry.metadata, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
};
