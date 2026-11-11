'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Eye,
  EyeOff,
  ChevronRight,
  RefreshCw,
  Search,
} from 'lucide-react';

import type {
  PostgresConfig,
  PostgresExposure,
  PostgresOverview as PostgresOverviewData,
  PostgresTable,
  Workload,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { postgresApi } from '@/api/workloads/postgres';
import { cn } from '@/lib/utils';
import { formatDecimalBytes } from '@/modules/workloads/utils/format-usage';
import { CopyButton } from '@/shared/components/copy-button';
import { Button } from '@/shared/components/ui/button';
import { DetailSection, DetailStack } from './detail-primitives';
import { WorkloadFailureNotice } from './workload-common-sections';

const REFRESH_MS = 10_000;
const SEARCH_FROM = 8;

type Load<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: T };

/**
 * Fetches once per `key` (null skips) and again on `reload` or every
 * `refreshMs`. A refetch keeps showing the last answer for the same key, so
 * a refresh never blanks the screen.
 */
const useLoad = <T,>(
  key: string | null,
  fetch: () => Promise<T>,
  refreshMs?: number,
): [Load<T>, () => void] => {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; load: Load<T> } | null>(
    null,
  );
  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (key === null) {
      return;
    }

    let active = true;

    fetch()
      .then(
        (data) => active && setResult({ key, load: { kind: 'ready', data } }),
      )
      .catch(
        (error) =>
          active &&
          setResult({
            key,
            load: { kind: 'error', message: getApiErrorMessage(error) },
          }),
      );

    return () => {
      active = false;
    };
    // `fetch` is rebuilt every render; the key and attempt decide a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  useEffect(() => {
    if (key === null || !refreshMs) {
      return;
    }

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        reload();
      }
    }, refreshMs);

    return () => clearInterval(timer);
  }, [key, refreshMs, reload]);

  return [
    result !== null && result.key === key ? result.load : { kind: 'loading' },
    reload,
  ];
};

const notRunning = (workload: Workload) =>
  workload.status === 'stopped'
    ? 'The database is stopped. Start it to read its state.'
    : workload.status === 'failed'
      ? 'The database is not running.'
      : 'Available once the database is running.';

/** A quiet line inside a card: loading, empty and unavailable states. */
const CardNote = ({
  children,
  tone = 'quiet',
}: {
  children: React.ReactNode;
  tone?: 'quiet' | 'error';
}) => (
  <p
    className={cn(
      'px-4 py-6 text-center text-xs',
      tone === 'error' ? 'text-status-danger' : 'text-fg-tertiary',
    )}
  >
    {children}
  </p>
);

/** The strip that opens a card: what it shows on the left, state on the right. */
const CardHeader = ({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) => (
  <div className="flex h-10 items-center justify-between gap-3 border-b border-edge-subtle px-4 text-xs">
    <div className="flex min-w-0 items-center gap-2">{children}</div>
    {aside ? (
      <div className="flex shrink-0 items-center gap-1">{aside}</div>
    ) : null}
  </div>
);

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-sm bg-surface-sunken px-1.5 text-[11px] leading-5 text-fg-secondary tabular-nums">
    {children}
  </span>
);

const LiveDot = () => (
  <span
    className="flex items-center gap-1.5 text-[11px] text-fg-tertiary"
    title={`Refreshes every ${REFRESH_MS / 1000} seconds`}
  >
    <span aria-hidden="true" className="relative flex size-1.5">
      <span className="absolute inset-0 animate-ping rounded-full bg-status-success/60 motion-reduce:hidden" />
      <span className="relative size-1.5 rounded-full bg-status-success" />
    </span>
    Live
  </span>
);

const RefreshButton = ({
  onClick,
  label = 'Refresh',
}: {
  onClick: () => void;
  label?: string;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="icon-xs"
    aria-label={label}
    onClick={onClick}
    className="text-fg-tertiary"
  >
    <RefreshCw aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
  </Button>
);

/** Tone of a fill that should stay well under its limit. */
const fillTone = (ratio: number) =>
  ratio >= 0.95
    ? 'bg-status-danger'
    : ratio >= 0.8
      ? 'bg-status-warning'
      : 'bg-fg-primary';

/** `1 d 4 h`, `3 h 12 m`, `7 m`: the two largest units. */
const formatUptime = (since: string, now = Date.now()) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);

  if (days > 0) {
    return `${days} d ${hours} h`;
  }

  return hours > 0 ? `${hours} h ${minutes % 60} m` : `${minutes} m`;
};

/** `17.11` from `17.11 (Debian 17.11-1.pgdg11+2)`. */
const shortVersion = (version: string) => version.split(' ')[0];

const Meter = ({
  label,
  value,
  unit,
  bar,
  foot,
}: {
  label: string;
  value: string;
  unit?: string;
  bar?: React.ReactNode;
  foot: React.ReactNode;
}) => (
  <div className="flex min-w-0 flex-col gap-2 bg-surface-raised px-4 py-3.5">
    <p className="text-xs text-fg-tertiary">{label}</p>
    <p className="flex items-baseline gap-1.5 font-mono tabular-nums">
      <span className="text-lg leading-6 font-medium text-fg-primary">
        {value}
      </span>
      {unit ? <span className="text-xs text-fg-tertiary">{unit}</span> : null}
    </p>
    {bar ?? <span aria-hidden="true" className="h-1.5" />}
    <p className="truncate text-[11px] leading-4 text-fg-tertiary">{foot}</p>
  </div>
);

const Bar = ({
  ratio,
  label,
  tone,
}: {
  ratio: number;
  label: string;
  tone: string;
}) => (
  <span
    role="meter"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
    className="block h-1.5 overflow-hidden rounded-full bg-edge-default"
  >
    <span
      className={cn('block h-full rounded-full', tone)}
      style={{
        width: `${Math.max(Math.min(ratio, 1) * 100, ratio > 0 ? 2 : 0)}%`,
      }}
    />
  </span>
);

/**
 * Every connection slot of the server in one line: active sessions solid,
 * idle ones hatched, free slots as the bare track.
 */
const ConnectionBar = ({
  active,
  idle,
  max,
}: {
  active: number;
  idle: number;
  max: number;
}) => {
  const used = (active + idle) / Math.max(max, 1);
  const share = (count: number) => `${(count / Math.max(max, 1)) * 100}%`;

  return (
    <span
      role="meter"
      aria-label="Connections in use"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={active + idle}
      aria-valuetext={`${active} active and ${idle} idle of ${max}`}
      className="flex h-1.5 overflow-hidden rounded-full bg-edge-default"
    >
      <span
        className={cn('h-full', fillTone(used))}
        style={{ width: share(active), minWidth: active > 0 ? 3 : 0 }}
      />
      <span
        className="h-full bg-[repeating-linear-gradient(135deg,var(--color-fg-tertiary)_0_2px,transparent_2px_4px)]"
        style={{ width: share(idle), minWidth: idle > 0 ? 3 : 0 }}
      />
    </span>
  );
};

const HealthCard = ({
  data,
  config,
}: {
  data: PostgresOverviewData;
  config: PostgresConfig | undefined;
}) => {
  const { connections } = data;
  const hit = data.cache_hit_ratio;

  return (
    <div className="grid gap-px bg-edge-subtle sm:grid-cols-2">
      <Meter
        label="Connections"
        value={String(connections.active + connections.idle)}
        unit={`of ${connections.max}`}
        bar={
          <ConnectionBar
            active={connections.active}
            idle={connections.idle}
            max={connections.max}
          />
        }
        foot={`${connections.active} active · ${connections.idle} idle`}
      />
      {/* Only the app database: WAL and other files share the disk, so a
          share of the disk would read lower than it is. */}
      <Meter
        label="Database size"
        value={formatDecimalBytes(data.database_size_bytes)}
        unit={config ? `on a ${config.size_gb} GiB disk` : undefined}
        foot="The app database, without WAL"
      />
      <Meter
        label="Cache hits"
        value={hit === null ? '—' : `${(hit * 100).toFixed(1)}%`}
        bar={
          hit === null ? undefined : (
            <Bar
              ratio={hit}
              label="Reads served from memory"
              tone={hit < 0.9 ? 'bg-status-warning' : 'bg-fg-primary'}
            />
          )
        }
        foot={hit === null ? 'No reads yet' : 'Reads served from memory'}
      />
      <Meter
        label="Transactions"
        value={String(data.transactions_per_second)}
        unit="/s"
        foot="Average since the server started"
      />
    </div>
  );
};

const LongQueries = ({ data }: { data: PostgresOverviewData }) => (
  <DetailSection
    title="Long-running queries"
    description="Statements running longer than 30 seconds."
  >
    <ul className="divide-y divide-edge-subtle">
      {data.long_queries.map((query) => (
        <li key={query.pid} className="flex flex-col gap-1 px-4 py-2.5">
          <div className="flex items-center justify-between gap-3 text-[11px] text-fg-tertiary tabular-nums">
            <span className="font-mono">pid {query.pid}</span>
            <span className="font-mono text-status-warning">
              {Math.round(query.duration_seconds)} s
            </span>
          </div>
          <code className="line-clamp-2 font-mono text-xs leading-5 break-all text-fg-primary">
            {query.query}
          </code>
        </li>
      ))}
    </ul>
  </DetailSection>
);

type Scope = 'project' | 'outside';

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  label: string;
}) => (
  <div
    role="group"
    aria-label={label}
    className="inline-flex rounded-md bg-surface-sunken p-0.5"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        disabled={option.disabled}
        title={option.title}
        onClick={() => onChange(option.value)}
        className={cn(
          'h-6 rounded-[5px] px-2.5 text-xs font-medium outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-brand-fg/50',
          'disabled:cursor-not-allowed disabled:text-fg-disabled',
          value === option.value
            ? 'bg-surface-raised text-fg-primary shadow-key-soft'
            : 'text-fg-tertiary enabled:hover:text-fg-primary',
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const Field = ({
  label,
  value,
  copy = false,
}: {
  label: string;
  value: string;
  copy?: boolean;
}) => (
  <div className="flex min-w-0 items-center gap-2 bg-surface-raised px-4 py-2.5">
    <dt className="w-16 shrink-0 text-xs text-fg-tertiary">{label}</dt>
    <dd
      className="min-w-0 flex-1 truncate font-mono text-xs text-fg-primary"
      title={value}
    >
      {value}
    </dd>
    {copy ? (
      <CopyButton
        value={value}
        label={label.toLowerCase()}
        className="text-fg-tertiary"
      />
    ) : null}
  </div>
);

/**
 * The database password, fetched only when the user asks to see it and
 * dropped again when hidden.
 */
export const usePostgresPassword = (workload: Workload) => {
  const [password, setPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async () => {
    setLoading(true);
    setError(null);

    try {
      const credentials = await postgresApi.credentials(
        workload.project_id,
        workload.id,
      );

      setPassword(credentials.password);
    } catch (revealError) {
      setError(getApiErrorMessage(revealError));
    } finally {
      setLoading(false);
    }
  };

  return {
    password,
    loading,
    error,
    toggle: () => (password === null ? void reveal() : setPassword(null)),
  };
};

/** Dots until the eye is pressed, then the password with a copy button. */
export const PasswordValue = ({
  state,
}: {
  state: ReturnType<typeof usePostgresPassword>;
}) => (
  <>
    <span
      className={cn(
        'min-w-0 flex-1 truncate font-mono text-xs',
        state.error
          ? 'font-sans text-status-danger'
          : state.password
            ? 'text-fg-primary'
            : 'tracking-widest text-fg-tertiary',
      )}
      title={state.password ?? undefined}
    >
      {state.error ?? state.password ?? (
        <>
          <span aria-hidden="true">••••••••••••</span>
          <span className="sr-only">Hidden</span>
        </>
      )}
    </span>
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={state.password ? 'Hide password' : 'Show password'}
      loading={state.loading}
      onClick={state.toggle}
      className="text-fg-tertiary"
    >
      {state.password ? (
        <EyeOff aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      ) : (
        <Eye aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      )}
    </Button>
    {state.password ? (
      <CopyButton
        value={state.password}
        label="password"
        className="text-fg-tertiary"
      />
    ) : null}
  </>
);

const ConnectCard = ({ workload }: { workload: Workload }) => {
  const passwordState = usePostgresPassword(workload);
  const connection = workload.postgres;
  const [scope, setScope] = useState<Scope>('project');
  const [exposure, setExposure] = useState<PostgresExposure | null>(null);

  useEffect(() => {
    let active = true;

    postgresApi
      .exposure(workload.project_id, workload.id)
      .then((data) => active && setExposure(data))
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [workload.project_id, workload.id, workload.status]);

  if (!connection) {
    return null;
  }

  const outside =
    scope === 'outside' &&
    exposure?.enabled &&
    exposure.host &&
    exposure.node_port
      ? { host: exposure.host, port: exposure.node_port }
      : null;
  const host = outside?.host ?? connection.host;
  const port = outside?.port ?? connection.port;
  const query = outside ? '?sslmode=require' : '';
  const secret = passwordState.password;
  const url = `postgresql://${connection.username}:${secret === null ? '<password>' : encodeURIComponent(secret)}@${host}:${port}/${connection.database}${query}`;
  const canGoOutside = Boolean(exposure?.enabled && exposure.host);

  return (
    <DetailSection title="Connect">
      <CardHeader
        aside={
          <Segmented<Scope>
            label="Connect from"
            value={outside ? 'outside' : 'project'}
            onChange={setScope}
            options={[
              { value: 'project', label: 'This project' },
              {
                value: 'outside',
                label: 'Outside',
                disabled: !canGoOutside,
                title: canGoOutside
                  ? undefined
                  : 'Open the port in Settings to connect from outside',
              },
            ]}
          />
        }
      >
        <span className="text-fg-secondary">
          {outside
            ? 'Over the internet, TLS required'
            : 'From services in this project'}
        </span>
      </CardHeader>

      <div className="flex items-start gap-2 border-b border-edge-subtle bg-surface-sunken/60 px-4 py-3">
        <code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all text-fg-primary">
          postgresql://{connection.username}:
          {secret === null ? (
            <span className="mx-px rounded-sm border border-edge-default bg-surface-raised px-1 text-fg-tertiary">
              password
            </span>
          ) : (
            encodeURIComponent(secret)
          )}
          @{host}:{port}/{connection.database}
          {query}
        </code>
        <CopyButton
          value={url}
          label="connection string"
          className="text-fg-tertiary"
        />
      </div>

      <dl className="grid gap-px bg-edge-subtle sm:grid-cols-2">
        <Field label="Host" value={host} copy />
        <Field label="Port" value={String(port)} />
        <Field label="Database" value={connection.database} copy />
        <Field label="User" value={connection.username} copy />
        <div className="flex min-w-0 items-center gap-2 bg-surface-raised px-4 py-2 sm:col-span-2">
          <dt className="w-16 shrink-0 text-xs text-fg-tertiary">Password</dt>
          <dd className="flex min-w-0 flex-1 items-center gap-1">
            <PasswordValue state={passwordState} />
          </dd>
        </div>
      </dl>
    </DetailSection>
  );
};

/** Health, slow statements and how to connect, for a running database. */
export const PostgresOverview = ({ workload }: { workload: Workload }) => {
  const config = workload.active_version?.config as PostgresConfig | undefined;
  const running = workload.status === 'running';
  const [state, reload] = useLoad(
    running ? `${workload.id}:overview` : null,
    () => postgresApi.overview(workload.project_id, workload.id),
    REFRESH_MS,
  );
  const data = state.kind === 'ready' ? state.data : null;

  return (
    <DetailStack>
      <WorkloadFailureNotice workload={workload} title="Database failed" />

      <DetailSection title="Health">
        <CardHeader
          aside={
            running ? (
              <>
                <LiveDot />
                <RefreshButton onClick={reload} label="Refresh health" />
              </>
            ) : undefined
          }
        >
          {data ? (
            <>
              <span className="font-mono font-medium text-fg-primary">
                PostgreSQL {shortVersion(data.version)}
              </span>
              <Chip>up {formatUptime(data.started_at)}</Chip>
              {data.waiting_locks > 0 ? (
                <span className="text-status-warning">
                  {data.waiting_locks} waiting for a lock
                </span>
              ) : null}
            </>
          ) : (
            <span className="font-medium text-fg-primary">
              PostgreSQL {config?.postgres_version ?? ''}
            </span>
          )}
        </CardHeader>

        {!running ? (
          <CardNote>{notRunning(workload)}</CardNote>
        ) : state.kind === 'error' ? (
          <CardNote tone="error">{state.message}</CardNote>
        ) : data ? (
          <HealthCard data={data} config={config} />
        ) : (
          <div aria-hidden="true" className="grid gap-px sm:grid-cols-2">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex flex-col gap-2 px-4 py-3.5">
                <span className="h-3 w-20 animate-[delayed-in_150ms_200ms_both] rounded bg-surface-sunken motion-reduce:animate-none" />
                <span className="h-6 w-16 animate-[delayed-in_150ms_200ms_both] rounded bg-surface-sunken motion-reduce:animate-none" />
                <span className="h-1.5 animate-[delayed-in_150ms_200ms_both] rounded-full bg-surface-sunken motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        )}
      </DetailSection>

      {data && data.long_queries.length > 0 ? (
        <LongQueries data={data} />
      ) : null}

      <ConnectCard workload={workload} />
    </DetailStack>
  );
};

const PAGE_SIZE = 50;

const TableRows = ({
  workload,
  table,
}: {
  workload: Workload;
  table: PostgresTable;
}) => {
  const [page, setPage] = useState(0);
  const [state, reload] = useLoad(
    JSON.stringify([workload.id, table.schema, table.name, page]),
    () =>
      postgresApi.rows(
        workload.project_id,
        workload.id,
        table.schema,
        table.name,
        page,
      ),
  );
  const first = page * PAGE_SIZE + 1;
  const shown = state.kind === 'ready' ? state.data.rows.length : 0;

  return (
    <div className="overflow-hidden panel-lit rounded-xl">
      {state.kind === 'loading' ? (
        <div aria-hidden="true" className="flex flex-col gap-2 p-4">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className="h-5 animate-[delayed-in_150ms_200ms_both] rounded bg-surface-sunken motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : state.kind === 'error' ? (
        <CardNote tone="error">{state.message}</CardNote>
      ) : state.data.rows.length === 0 ? (
        <CardNote>
          {page === 0 ? 'This table has no rows.' : 'No more rows.'}
        </CardNote>
      ) : (
        <div className="max-h-[28rem] overflow-auto overscroll-contain">
          <table className="w-full border-separate border-spacing-0 text-left font-mono text-xs">
            <thead className="sticky top-0 z-10 bg-surface-panel text-fg-tertiary">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 w-10 border-b border-edge-subtle bg-surface-panel px-2 py-2 text-right font-normal"
                >
                  <span className="sr-only">Row</span>#
                </th>
                {state.data.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-edge-subtle px-3 py-2 font-medium whitespace-nowrap text-fg-secondary"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data.rows.map((row, index) => (
                <tr key={index} className="group">
                  <td className="sticky left-0 border-b border-edge-subtle bg-surface-raised px-2 py-1.5 text-right text-fg-disabled tabular-nums group-hover:bg-surface-sunken">
                    {first + index}
                  </td>
                  {row.map((value, column) => (
                    <td
                      key={column}
                      title={value ?? 'NULL'}
                      className="max-w-60 truncate border-b border-edge-subtle px-3 py-1.5 text-fg-primary group-hover:bg-surface-sunken"
                    >
                      {value ?? (
                        <span className="text-fg-disabled italic">null</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex h-10 items-center justify-between gap-3 border-t border-edge-subtle px-3 text-xs">
        <span className="text-fg-tertiary tabular-nums">
          {shown > 0 ? `Rows ${first}–${first + shown - 1}` : 'Read-only'}
        </span>
        <div className="flex items-center gap-0.5">
          <RefreshButton onClick={reload} label="Reload rows" />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Next page"
            disabled={state.kind !== 'ready' || !state.data.has_more}
            onClick={() => setPage((value) => value + 1)}
          >
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const TableIndexes = ({ table }: { table: PostgresTable }) => (
  <div className="overflow-hidden panel-lit rounded-xl">
    {table.indexes.length === 0 ? (
      <CardNote>This table has no indexes.</CardNote>
    ) : (
      <ul className="divide-y divide-edge-subtle">
        {table.indexes.map((index) => (
          <li key={index.name} className="flex items-start gap-2 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-xs font-medium text-fg-primary">
                  {index.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-tertiary tabular-nums">
                  {formatDecimalBytes(index.size_bytes)}
                </span>
              </p>
              <code className="mt-0.5 block font-mono text-[11px] leading-4 break-all text-fg-tertiary">
                {index.definition}
              </code>
            </div>
            <CopyButton
              value={index.definition}
              label="index definition"
              className="text-fg-tertiary"
            />
          </li>
        ))}
      </ul>
    )}
  </div>
);

const rowsLabel = (table: PostgresTable) =>
  table.row_estimate < 0
    ? 'not analyzed'
    : `~${table.row_estimate.toLocaleString()} rows`;

const TableDetail = ({
  workload,
  table,
  onBack,
}: {
  workload: Workload;
  table: PostgresTable;
  onBack: () => void;
}) => {
  const [view, setView] = useState<'rows' | 'indexes'>('rows');

  return (
    <DetailStack className="gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 text-fg-secondary"
        >
          <ChevronLeft data-icon="inline-start" aria-hidden="true" />
          Tables
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-medium text-fg-primary">
            <span className="text-fg-tertiary">{table.schema}.</span>
            {table.name}
          </h3>
          <p className="mt-0.5 text-xs text-fg-tertiary tabular-nums">
            {rowsLabel(table)} · {formatDecimalBytes(table.size_bytes)}
          </p>
        </div>
        <Segmented<'rows' | 'indexes'>
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'rows', label: 'Rows' },
            { value: 'indexes', label: `Indexes ${table.indexes.length}` },
          ]}
        />
      </div>

      {view === 'rows' ? (
        <TableRows workload={workload} table={table} />
      ) : (
        <TableIndexes table={table} />
      )}
    </DetailStack>
  );
};

/** Tables of the application database; one opens to its rows and indexes. */
export const PostgresData = ({ workload }: { workload: Workload }) => {
  const running = workload.status === 'running';
  const [state, reload] = useLoad(
    running ? `${workload.id}:tables` : null,
    () => postgresApi.tables(workload.project_id, workload.id),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const tables = useMemo(
    () =>
      state.kind === 'ready'
        ? [...state.data].sort(
            (left, right) =>
              left.schema.localeCompare(right.schema) ||
              left.name.localeCompare(right.name),
          )
        : [],
    [state],
  );
  const table = tables.find((item) => `${item.schema}.${item.name}` === picked);
  const visible = tables.filter((item) =>
    `${item.schema}.${item.name}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const schemas = [...new Set(visible.map((item) => item.schema))];

  if (table && running) {
    return (
      <TableDetail
        workload={workload}
        table={table}
        onBack={() => setPicked(null)}
      />
    );
  }

  return (
    <DetailStack>
      <DetailSection
        title="Tables"
        description="The app database, read-only."
        action={
          running ? (
            <RefreshButton onClick={reload} label="Reload tables" />
          ) : undefined
        }
      >
        {tables.length >= SEARCH_FROM ? (
          <label className="flex h-10 items-center gap-2 border-b border-edge-subtle px-4">
            <Search
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 text-fg-tertiary"
            />
            <span className="sr-only">Find a table</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Find in ${tables.length} tables`}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-fg-primary outline-none placeholder:font-sans placeholder:text-fg-tertiary"
            />
          </label>
        ) : null}

        {!running ? (
          <CardNote>{notRunning(workload)}</CardNote>
        ) : state.kind === 'loading' ? (
          <div aria-hidden="true" className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-6 animate-[delayed-in_150ms_200ms_both] rounded bg-surface-sunken motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : state.kind === 'error' ? (
          <CardNote tone="error">{state.message}</CardNote>
        ) : tables.length === 0 ? (
          <CardNote>
            No tables yet. Tables your services create in the app database
            appear here.
          </CardNote>
        ) : visible.length === 0 ? (
          <CardNote>No table matches “{search.trim()}”.</CardNote>
        ) : (
          schemas.map((schema, schemaIndex) => (
            <div key={schema}>
              {schemas.length > 1 ? (
                <p
                  className={cn(
                    'bg-surface-panel/60 px-4 py-1.5 font-mono text-[11px] text-fg-tertiary',
                    schemaIndex > 0 && 'border-t border-edge-subtle',
                  )}
                >
                  {schema}
                </p>
              ) : null}
              <ul className="divide-y divide-edge-subtle border-t border-edge-subtle first:border-t-0">
                {visible
                  .filter((item) => item.schema === schema)
                  .map((item) => (
                    <li key={item.name}>
                      <button
                        type="button"
                        onClick={() => setPicked(`${item.schema}.${item.name}`)}
                        className="group flex h-11 w-full items-center gap-3 px-4 text-left outline-none transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-fg/50"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-primary">
                          {item.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-fg-tertiary tabular-nums">
                          {rowsLabel(item)}
                        </span>
                        <span className="w-16 shrink-0 text-right font-mono text-[11px] text-fg-tertiary tabular-nums">
                          {formatDecimalBytes(item.size_bytes)}
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          strokeWidth={1.75}
                          className="size-3.5 shrink-0 text-fg-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-fg-secondary motion-reduce:transition-none"
                        />
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </DetailSection>
    </DetailStack>
  );
};
