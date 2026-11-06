'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Circle, LoaderCircle, X } from 'lucide-react';

import type {
  PlatformUpdateDetails,
  PlatformUpdateStatus,
} from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/shared/components/copy-button';
import { formatAbsoluteTime } from '@/modules/workloads/utils/format-time';
import {
  UPDATE_STATUS_LABELS,
  formatElapsed,
  formatVersion,
  isUpdateActive,
  updateProgress,
  updateSteps,
  type PlatformStatusTone,
  type UpdateStepState,
} from '../utils/platform-update';
import { PlatformStatusBadge } from './platform-status-badge';

type PlatformUpdateProgressProps = {
  update: PlatformUpdateDetails;
  /** The API did not answer the last poll: it is probably restarting. */
  reconnecting: boolean;
};

const STEP_ICONS: Record<UpdateStepState, typeof Check> = {
  done: Check,
  current: LoaderCircle,
  failed: X,
  pending: Circle,
};

const STATUS_TONES: Record<PlatformUpdateStatus, PlatformStatusTone> = {
  pending: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  rolled_back: 'danger',
};

/** Re-renders every second while `active`, for the elapsed time. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  return now;
};

/** Steps, outcome and log of an update, live while it runs. */
export const PlatformUpdateProgress = ({
  update,
  reconnecting,
}: PlatformUpdateProgressProps) => {
  const logRef = useRef<HTMLPreElement>(null);
  const active = isUpdateActive(update);
  const steps = updateSteps(update);
  const progress = updateProgress(steps);
  const now = useNow(active);
  const elapsed = formatElapsed(update.started_at, update.finished_at ?? now);

  // Follow the end of the log while it grows, unless the reader scrolled up.
  useEffect(() => {
    const element = logRef.current;

    if (!element) {
      return;
    }

    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;

    if (nearBottom || active) {
      element.scrollTop = element.scrollHeight;
    }
  }, [update.log, active]);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-surface-sunken px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <PlatformStatusBadge
            tone={STATUS_TONES[update.status]}
            label={UPDATE_STATUS_LABELS[update.status]}
            busy={active}
          />
          <span className="font-mono text-sm text-foreground tabular-nums">
            {formatVersion(update.from_version)} →{' '}
            {formatVersion(update.to_version)}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground tabular-nums">
          <time
            dateTime={update.started_at}
            title={formatAbsoluteTime(update.started_at)}
          >
            {formatAbsoluteTime(update.started_at)}
          </time>
          {' · '}
          {active ? `${elapsed} so far` : `took ${elapsed}`}
          {update.actor ? ` · ${update.actor}` : ''}
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Update progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="flex h-1 gap-px bg-surface-raised"
      >
        {steps.map((step) => (
          <span
            key={step.stage}
            className={cn(
              'flex-1 bg-surface-muted transition-colors motion-reduce:transition-none',
              step.state === 'done' &&
                (update.status === 'succeeded'
                  ? 'bg-status-success'
                  : 'bg-brand-fg'),
              step.state === 'current' &&
                'animate-pulse bg-brand-fg/50 motion-reduce:animate-none',
              step.state === 'failed' && 'bg-status-danger',
            )}
          />
        ))}
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-2" aria-label="Update steps">
            {steps.map((step) => {
              const Icon = STEP_ICONS[step.state];

              return (
                <li
                  key={step.stage}
                  className={cn(
                    'flex items-start gap-2 text-[13px] leading-snug',
                    step.state === 'pending'
                      ? 'text-muted-foreground'
                      : 'text-foreground',
                    step.state === 'current' && 'font-medium',
                    step.state === 'failed' && 'text-destructive',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-px flex size-4 shrink-0 items-center justify-center rounded-full',
                      step.state === 'done' &&
                        'bg-status-success/10 text-status-success',
                      step.state === 'current' && 'text-brand-fg',
                      step.state === 'failed' &&
                        'bg-status-danger/10 text-status-danger',
                    )}
                  >
                    <Icon
                      strokeWidth={step.state === 'pending' ? 1.75 : 2.5}
                      className={cn(
                        step.state === 'pending' ? 'size-2' : 'size-3',
                        step.state === 'current' &&
                          'size-3.5 animate-spin motion-reduce:animate-none',
                      )}
                    />
                  </span>
                  {step.label}
                  <span className="sr-only">
                    {step.state === 'done'
                      ? '(done)'
                      : step.state === 'current'
                        ? '(in progress)'
                        : step.state === 'failed'
                          ? '(failed)'
                          : '(not started)'}
                  </span>
                </li>
              );
            })}
          </ol>

          {active ? (
            <p
              role="status"
              className={cn(
                'rounded-md border px-3 py-2 text-[12px] leading-relaxed',
                reconnecting
                  ? 'border-status-warning/30 bg-status-warning/5 text-foreground'
                  : 'border-border text-muted-foreground',
              )}
            >
              {reconnecting
                ? 'Waiting for the API to come back. It restarts during the update; this page reconnects on its own.'
                : 'Runs on the server and keeps going if you close this page. The API and the console restart near the end.'}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {!active && update.message ? (
            <p
              role={update.status === 'succeeded' ? 'status' : 'alert'}
              className={cn(
                'rounded-md border px-3 py-2 text-[13px] leading-relaxed text-foreground',
                update.status === 'succeeded'
                  ? 'border-status-success/30 bg-status-success/5'
                  : 'border-status-danger/30 bg-status-danger/5',
              )}
            >
              {update.message}
            </p>
          ) : null}

          <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-terminal-edge bg-terminal-surface">
            <div className="flex items-center justify-between gap-2 border-b border-terminal-edge bg-terminal-chrome py-1 pr-1 pl-3">
              <span className="text-[12px] text-terminal-fg-muted">
                Update log
              </span>
              {update.log ? (
                <CopyButton
                  value={update.log}
                  label="update log"
                  className="text-terminal-fg-muted hover:bg-white/10 hover:text-terminal-fg"
                />
              ) : null}
            </div>
            <pre
              ref={logRef}
              tabIndex={0}
              aria-label="Update log"
              className="h-72 overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-terminal-fg"
            >
              {update.log ||
                (active
                  ? 'Waiting for the server to report…'
                  : 'No log was recorded.')}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
