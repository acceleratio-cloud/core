'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  CircleCheck,
  CircleSlash,
  CircleX,
  ExternalLink,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';

import type { GithubWorkloadConfig, WorkloadBuild } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
import {
  DetailNotice,
  DetailSection,
  MonoBadge,
} from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { effectiveConfig } from '@/modules/workloads/utils/workload-config';
import { VersionAuthor } from '@/modules/workloads/components/workload-details/version-author';
import { CopyButton } from '@/shared/components/copy-button';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useWorkloadActions } from './workload-actions';

/** How often a running build and its log are refreshed. */
const POLL_MS = 3000;

const STATUS: Record<
  WorkloadBuild['status'],
  { label: string; icon: LucideIcon; className: string }
> = {
  building: {
    label: 'Building',
    icon: LoaderCircle,
    className: 'animate-spin text-brand-fg motion-reduce:animate-none',
  },
  succeeded: {
    label: 'Built',
    icon: CircleCheck,
    className: 'text-status-success',
  },
  failed: { label: 'Failed', icon: CircleX, className: 'text-status-danger' },
  cancelled: {
    label: 'Cancelled',
    icon: CircleSlash,
    className: 'text-fg-tertiary',
  },
};

/** Follows a value while `active`, refetching every POLL_MS. */
const usePolled = <T,>(
  load: () => Promise<T>,
  key: string,
  active: boolean,
) => {
  const [state, setState] = useState<{
    key: string | null;
    value: T | null;
    error: string | null;
  }>({ key: null, value: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    load()
      .then((value) => {
        if (!cancelled) setState({ key, value, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            key,
            error: getApiErrorMessage(error),
          }));
        }
      });

    const timer = active
      ? setTimeout(() => setTick((value) => value + 1), POLL_MS)
      : undefined;

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `load` changes every render; `key` names what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, tick]);

  return { ...state, isLoading: state.key !== key };
};

/** The current time, ticking every second while `active`. */
const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [active]);

  return now;
};

/** "48s", "3m 12s", "1h 4m". */
const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const buildDuration = (build: WorkloadBuild, now: number) =>
  formatDuration(
    (build.finished_at ? Date.parse(build.finished_at) : now) -
      Date.parse(build.created_at),
  );

const BuildStatusIcon = ({ status }: { status: WorkloadBuild['status'] }) => {
  const { icon: Icon, className } = STATUS[status];

  return (
    <Icon
      aria-hidden="true"
      strokeWidth={2}
      className={cn('size-4 shrink-0', className)}
    />
  );
};

/**
 * The builder's output on the console's terminal surface. While the build
 * runs it follows the newest line, unless the reader scrolled up.
 */
const BuildLog = ({ build }: { build: WorkloadBuild }) => {
  const { project } = useProject();
  const { value, error, isLoading } = usePolled(
    () => workloadsApi.buildLog(project.id, build.workload_id, build.id),
    `${build.id}/${build.status}`,
    build.status === 'building',
  );
  const output = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  const log = value?.log ?? '';

  useEffect(() => {
    const element = output.current;

    if (element && following.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [log]);

  return (
    <div className="overflow-hidden rounded-md border border-terminal-edge bg-terminal-surface">
      <div className="flex h-8 items-center gap-2 border-b border-terminal-edge bg-terminal-chrome pr-1 pl-3">
        <span className="flex-1 text-xs font-medium text-terminal-fg-muted">
          Build output
        </span>
        {build.status === 'building' ? (
          <span className="flex items-center gap-1.5 text-xs text-terminal-fg-muted">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-status-success motion-reduce:animate-none"
            />
            Live
          </span>
        ) : null}
        {log ? (
          <CopyButton
            value={log}
            label="build output"
            className="text-terminal-fg-muted hover:bg-terminal-tab-active hover:text-terminal-fg"
          />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-3 py-2.5 text-xs text-status-danger">
          {error}
        </p>
      ) : (
        <pre
          ref={output}
          aria-busy={isLoading}
          aria-label="Build output"
          tabIndex={0}
          onScroll={(event) => {
            const element = event.currentTarget;

            following.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              24;
          }}
          className="max-h-96 overflow-auto px-3 py-2.5 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-terminal-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        >
          {log || (isLoading ? 'Loading…' : 'No output yet.')}
        </pre>
      )}
    </div>
  );
};

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <dt className="text-[11px] leading-4 text-fg-tertiary">{label}</dt>
    <dd className="flex min-w-0 items-center gap-1 text-xs leading-5 text-fg-primary tabular-nums">
      {children}
    </dd>
  </div>
);

/** An opened build: its facts, its failure and its output. */
const BuildDetails = ({
  build,
  repository,
  now,
  busy,
  onCancel,
}: {
  build: WorkloadBuild;
  repository: string | undefined;
  now: number;
  busy: boolean;
  onCancel: () => void;
}) => {
  const digest = build.image?.split('@')[1];

  return (
    <div className="flex flex-col gap-3 px-3 pt-1 pb-3 pl-9">
      <div className="flex items-start gap-4">
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Fact label="Commit">
            {repository ? (
              <a
                href={`https://github.com/${repository}/commit/${build.commit_sha}`}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-1 font-mono underline-offset-2 hover:underline focus-visible:underline"
              >
                {build.commit_sha.slice(0, 7)}
                <ExternalLink
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3 text-fg-tertiary transition-colors group-hover:text-fg-secondary"
                />
                <span className="sr-only">(opens GitHub)</span>
              </a>
            ) : (
              <span className="font-mono">{build.commit_sha.slice(0, 7)}</span>
            )}
          </Fact>
          <Fact label="Started">
            <time
              dateTime={build.created_at}
              title={formatAbsoluteTime(build.created_at)}
            >
              {formatRelativeTime(build.created_at)}
            </time>
          </Fact>
          <Fact label="Duration">{buildDuration(build, now)}</Fact>
          {digest ? (
            <Fact label="Image">
              <span className="truncate font-mono" title={build.image ?? ''}>
                {digest.slice(0, 19)}
              </span>
              <CopyButton value={build.image ?? ''} label="image reference" />
            </Fact>
          ) : null}
        </dl>
        {build.status === 'building' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busy}
            disabled={busy}
            onClick={onCancel}
          >
            {busy ? 'Cancelling' : 'Cancel build'}
          </Button>
        ) : null}
      </div>
      {build.status === 'failed' ? (
        <DetailNotice
          title="Build failed"
          message={build.status_message ?? 'See the build output below.'}
        />
      ) : build.status === 'cancelled' && build.status_message ? (
        <p className="text-xs text-fg-tertiary">{build.status_message}</p>
      ) : null}
      <BuildLog build={build} />
    </div>
  );
};

/**
 * Builds of a GitHub service, newest first. Each deploy builds the branch
 * head unless the running image already comes from it; a row opens the
 * build's facts and the builder's output. A running or failed latest build
 * opens by itself.
 */
export const GithubWorkloadBuilds = () => {
  const { project, refreshWorkloads } = useProject();
  const { workload } = useWorkloadActions();
  const [open, setOpen] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // A deploy turns the service to `deploying`; follow it until it settles.
  const following = workload.status === 'deploying';
  const { value, error, isLoading } = usePolled(
    () => workloadsApi.builds(project.id, workload.id),
    `${workload.id}/${workload.status}/${workload.updated_at}/${revision}`,
    following,
  );
  const autoDeploy = workload.auto_deploy ?? true;
  const repository = (
    effectiveConfig(workload) as unknown as Partial<GithubWorkloadConfig>
  ).repository;
  const builds = value ?? [];
  const latest = builds[0];
  const now = useNow(latest?.status === 'building');
  const expanded =
    open ??
    (latest?.status === 'building' || latest?.status === 'failed'
      ? latest.id
      : null);

  const cancel = async (build: WorkloadBuild) => {
    setBusy(true);
    setActionError(null);

    try {
      await workloadsApi.cancelBuild(project.id, workload.id, build.id);
      setRevision((value) => value + 1);
      await refreshWorkloads();
    } catch (failure) {
      setActionError(getApiErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailSection
      title="Builds"
      description={
        autoDeploy
          ? 'A push to the branch deploys it once the service has been deployed. Turn this off in Configuration.'
          : 'Only Deploy builds the branch; pushes are ignored. Turn on Deploy on push in Configuration.'
      }
    >
      {actionError ? (
        <p role="alert" className="px-3 pt-3 text-xs text-status-danger">
          {actionError}
        </p>
      ) : null}
      {isLoading && value === null ? (
        <div className="flex flex-col gap-2 px-3 py-3" aria-busy="true">
          <span className="sr-only">Loading builds</span>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ) : error && value === null ? (
        <p role="alert" className="px-3 py-3 text-xs text-status-danger">
          {error}
        </p>
      ) : builds.length === 0 ? (
        <p className="px-3 py-3 text-xs leading-relaxed text-fg-tertiary">
          No builds yet. Deploy builds the branch&rsquo;s Dockerfile, or uses
          Railpack without one.
        </p>
      ) : (
        <ol className="divide-y divide-edge-subtle">
          {builds.map((build) => {
            const isOpen = expanded === build.id;
            const detailsId = `build-${build.id}`;

            return (
              <li key={build.id} className={cn(isOpen && 'bg-surface-panel')}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={detailsId}
                  onClick={() => setOpen(isOpen ? '' : build.id)}
                  className="group flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] motion-reduce:transition-none"
                >
                  <span className="mt-0.5 flex">
                    <BuildStatusIcon status={build.status} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] leading-5 font-medium text-fg-primary">
                      {build.commit_message ?? 'No commit message'}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-fg-tertiary">
                      <span
                        className={cn(
                          'shrink-0 font-medium',
                          build.status === 'failed'
                            ? 'text-status-danger'
                            : 'text-fg-secondary',
                        )}
                      >
                        {STATUS[build.status].label}
                      </span>
                      <span aria-hidden="true">·</span>
                      <MonoBadge>{build.commit_sha.slice(0, 7)}</MonoBadge>
                      {build.author ? (
                        <span className="hidden min-w-0 truncate sm:inline">
                          <VersionAuthor author={build.author} link={false} />
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs leading-5 text-fg-tertiary tabular-nums">
                    <time
                      dateTime={build.created_at}
                      title={formatAbsoluteTime(build.created_at)}
                    >
                      {formatRelativeTime(build.created_at)}
                    </time>
                    <span>{buildDuration(build, now)}</span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 size-4 shrink-0 text-fg-tertiary transition-transform group-hover:text-fg-secondary motion-reduce:transition-none',
                      isOpen && 'rotate-90',
                    )}
                  />
                </button>
                {isOpen ? (
                  <div id={detailsId}>
                    <BuildDetails
                      build={build}
                      repository={repository}
                      now={now}
                      busy={busy}
                      onCancel={() => void cancel(build)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </DetailSection>
  );
};
