import { ChevronRight } from 'lucide-react';

import type { PlatformUpdate } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import {
  UPDATE_STATUS_LABELS,
  formatElapsed,
  formatVersion,
} from '../utils/platform-update';

type PlatformUpdateHistoryProps = {
  updates: PlatformUpdate[];
  /** The update shown in detail, highlighted in the list. */
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/** Every update started from the console, newest first. */
export const PlatformUpdateHistory = ({
  updates,
  selectedId,
  onSelect,
}: PlatformUpdateHistoryProps) => {
  if (updates.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
        No updates were started from the console yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border">
      {updates.map((update) => {
        const selected = update.id === selectedId;

        return (
          <li key={update.id}>
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(update.id)}
              className={cn(
                'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-left outline-none hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                selected && 'bg-surface-sunken',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 rounded-full',
                  update.status === 'succeeded' && 'bg-status-success',
                  (update.status === 'failed' ||
                    update.status === 'rolled_back') &&
                    'bg-status-danger',
                  (update.status === 'pending' ||
                    update.status === 'running') &&
                    'animate-pulse bg-brand-fg motion-reduce:animate-none',
                )}
              />
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[13px] text-foreground tabular-nums">
                  {formatVersion(update.from_version)} →{' '}
                  {formatVersion(update.to_version)}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {UPDATE_STATUS_LABELS[update.status]}
                  {update.finished_at
                    ? ` in ${formatElapsed(update.started_at, update.finished_at)}`
                    : ''}
                  {update.actor ? ` · ${update.actor}` : ''}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <time
                  dateTime={update.started_at}
                  title={formatAbsoluteTime(update.started_at)}
                >
                  {formatRelativeTime(update.started_at)}
                </time>
                <ChevronRight
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3.5"
                />
              </span>
              {update.message && update.status !== 'succeeded' ? (
                <span className="col-start-2 col-end-4 truncate text-[12px] text-muted-foreground">
                  {update.message}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
