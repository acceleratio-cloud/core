import {
  CircleAlert,
  Info,
  Lock,
  Minus,
  PenLine,
  Plus,
  RotateCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import type {
  WorkloadChangeKind,
  WorkloadConfigChange,
  WorkloadDiffSide,
  WorkloadVersionDiff,
} from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/shared/components/ui/skeleton';

/** `v3`, `Pending changes` or `Nothing deployed`. */
export const diffSideLabel = (side: WorkloadDiffSide) =>
  side.kind === 'version'
    ? `v${side.number}`
    : side.kind === 'draft'
      ? 'Pending changes'
      : 'Nothing deployed';

const KIND: Record<
  WorkloadChangeKind,
  { word: string; icon: LucideIcon; tone: string }
> = {
  added: { word: 'Added', icon: Plus, tone: 'text-status-success' },
  removed: { word: 'Removed', icon: Minus, tone: 'text-status-danger' },
  changed: { word: 'Changed', icon: PenLine, tone: 'text-status-warning' },
};

/** The side-by-side value of one change; secret values are never present. */
const ChangeValues = ({ change }: { change: WorkloadConfigChange }) => {
  if (change.secret) {
    return (
      <span className="inline-flex items-center gap-1 text-fg-tertiary">
        <Lock aria-hidden="true" strokeWidth={1.75} className="size-3" />
        {change.kind === 'changed'
          ? 'Value changed, hidden'
          : change.kind === 'added'
            ? 'New variable, value hidden'
            : 'Variable removed'}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-mono">
      {change.before !== null ? (
        <span
          className={cn(
            'break-all text-fg-tertiary',
            change.kind === 'removed' || change.kind === 'changed'
              ? 'line-through decoration-fg-tertiary/60'
              : null,
          )}
        >
          <span className="sr-only">Before: </span>
          {change.before}
        </span>
      ) : null}
      {change.before !== null && change.after !== null ? (
        <span aria-hidden="true" className="text-fg-tertiary">
          →
        </span>
      ) : null}
      {change.after !== null ? (
        <span className="break-all text-fg-primary">
          <span className="sr-only">After: </span>
          {change.after}
        </span>
      ) : null}
    </span>
  );
};

const ImpactChip = ({ change }: { change: WorkloadConfigChange }) =>
  change.impact === null ? null : (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-[18px]',
        change.impact === 'data_loss'
          ? 'border-status-danger/40 bg-status-danger/10 text-status-danger'
          : 'border-edge-default text-fg-secondary',
      )}
    >
      {change.impact === 'data_loss' ? (
        <TriangleAlert
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3"
        />
      ) : (
        <RotateCw aria-hidden="true" strokeWidth={1.75} className="size-3" />
      )}
      {change.impact === 'data_loss' ? 'Deletes data' : 'Restarts pods'}
    </span>
  );

const ChangeRow = ({ change }: { change: WorkloadConfigChange }) => {
  const kind = KIND[change.kind];
  const Icon = kind.icon;

  return (
    <li className="flex items-start gap-2.5 px-3 py-2 text-xs leading-5">
      <Icon
        aria-hidden="true"
        strokeWidth={2}
        className={cn('mt-[3px] size-3.5 shrink-0', kind.tone)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="sr-only">{kind.word}: </span>
          <span
            className="min-w-0 truncate font-medium text-fg-primary"
            title={change.label}
          >
            {change.label}
          </span>
          <span aria-hidden="true" className={cn('shrink-0', kind.tone)}>
            {kind.word}
          </span>
          <span className="flex-1" />
          <ImpactChip change={change} />
        </div>
        <ChangeValues change={change} />
      </div>
    </li>
  );
};

/** What applying the target does to the running service, in one line each. */
const ImpactSummary = ({ diff }: { diff: WorkloadVersionDiff }) => {
  const lines: { icon: LucideIcon; tone: string; text: string }[] = [];

  if (diff.data_loss) {
    lines.push({
      icon: TriangleAlert,
      tone: 'text-status-danger',
      text: 'Volumes this removes are deleted with their data. This cannot be undone.',
    });
  }

  if (diff.restarts) {
    lines.push({
      icon: RotateCw,
      tone: 'text-status-warning',
      text: 'The running pods are replaced by a rolling update.',
    });
  } else if (!diff.identical && diff.base.kind !== 'none') {
    lines.push({
      icon: Info,
      tone: 'text-fg-tertiary',
      text: 'Applies without restarting the pods.',
    });
  }

  for (const note of diff.notes) {
    lines.push({ icon: Info, tone: 'text-fg-tertiary', text: note });
  }

  if (lines.length === 0) {
    return null;
  }

  return (
    <ul
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-xs leading-5',
        diff.data_loss
          ? 'border-status-danger/40 bg-status-danger/10'
          : 'border-edge-default bg-surface-sunken',
      )}
    >
      {lines.map(({ icon: Icon, tone, text }) => (
        <li key={text} className="flex items-start gap-2 text-fg-secondary">
          <Icon
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn('mt-[3px] size-3.5 shrink-0', tone)}
          />
          {text}
        </li>
      ))}
    </ul>
  );
};

/**
 * A comparison computed by the API: an impact summary, then the changed
 * fields by section, each marked added, removed or changed in both an icon
 * color and a word. Secret values never reach the console.
 */
export const VersionDiffView = ({ diff }: { diff: WorkloadVersionDiff }) => {
  if (diff.identical) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-lg border border-edge-default bg-surface-sunken px-3 py-3 text-xs leading-5 text-fg-tertiary">
          {diffSideLabel(diff.target)} and {diffSideLabel(diff.base)} have the
          same configuration.
        </p>
        {diff.notes.length > 0 ? <ImpactSummary diff={diff} /> : null}
      </div>
    );
  }

  const count = diff.sections.reduce(
    (total, section) => total + section.changes.length,
    0,
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-5 text-fg-tertiary">
        {count} {count === 1 ? 'change' : 'changes'} from{' '}
        <span className="text-fg-secondary">{diffSideLabel(diff.base)}</span> to{' '}
        <span className="text-fg-secondary">{diffSideLabel(diff.target)}</span>.
      </p>

      <ImpactSummary diff={diff} />

      {diff.sections.map((section) => (
        <section key={section.key} aria-label={section.label}>
          <h4 className="mb-1.5 px-1 text-xs font-medium text-fg-secondary">
            {section.label}
          </h4>
          <ul className="divide-y divide-edge-subtle overflow-hidden rounded-lg border border-edge-default bg-surface-raised">
            {section.changes.map((change) => (
              <ChangeRow key={change.path} change={change} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

export const VersionDiffSkeleton = () => (
  <div aria-busy="true" className="flex flex-col gap-3">
    <span className="sr-only">Comparing versions</span>
    <Skeleton className="h-4 w-1/3" />
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
);

export const VersionDiffError = ({ message }: { message: string }) => (
  <p
    role="alert"
    className="flex items-start gap-2 text-xs leading-relaxed text-destructive"
  >
    <CircleAlert
      aria-hidden="true"
      strokeWidth={1.75}
      className="mt-0.5 size-3.5 shrink-0"
    />
    {message}
  </p>
);
