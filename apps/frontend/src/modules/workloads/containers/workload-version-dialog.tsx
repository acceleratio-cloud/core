'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GitCompareArrows, SlidersHorizontal, Undo2 } from 'lucide-react';

import type { WorkloadConfig, WorkloadVersion } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
import {
  VersionDiffError,
  VersionDiffSkeleton,
  VersionDiffView,
} from '@/modules/workloads/components/workload-details/version-diff';
import { useVersionDiff } from '@/modules/workloads/hooks/use-version-diff';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';

/** What the dialog shows: a stored version, or the pending changes. */
export type VersionSubject =
  | { kind: 'version'; version: WorkloadVersion }
  | { kind: 'draft'; config: WorkloadConfig };

export type VersionDialogTab = 'configuration' | 'changes';

type VersionStatus = 'active' | 'draft' | 'previous';

const STATUS: Record<VersionStatus, { label: string; className: string }> = {
  active: {
    label: 'Active',
    className: 'border-status-success/30 bg-status-success/10',
  },
  draft: {
    label: 'Pending',
    className: 'border-status-warning/30 bg-status-warning/10',
  },
  previous: {
    label: 'Previous',
    className: 'border-edge-default bg-surface-sunken',
  },
};

export const VersionStatusChip = ({ status }: { status: VersionStatus }) => (
  <span
    className={cn(
      'shrink-0 rounded-full border px-2 text-xs leading-5 text-fg-secondary',
      STATUS[status].className,
    )}
  >
    {STATUS[status].label}
  </span>
);

interface CompareOption {
  value: string;
  label: string;
}

/**
 * The sides a subject can be compared with: the active version, the pending
 * changes and every other version, newest first. The subject itself is
 * never offered.
 */
const compareOptions = (
  subject: VersionSubject,
  versions: WorkloadVersion[],
  activeId: string | null,
  hasDraft: boolean,
): CompareOption[] => {
  const subjectId = subject.kind === 'version' ? subject.version.id : null;
  const active = versions.find((version) => version.id === activeId);
  const options: CompareOption[] = [];

  if (active && active.id !== subjectId) {
    options.push({ value: 'active', label: `Active · v${active.number}` });
  }

  if (hasDraft && subject.kind !== 'draft') {
    options.push({ value: 'draft', label: 'Pending changes' });
  }

  for (const version of versions) {
    if (version.id !== subjectId && version.id !== activeId) {
      options.push({ value: version.id, label: `v${version.number}` });
    }
  }

  return options;
};

/**
 * The default comparison: against the active version, or for the active
 * version itself, against the one before it.
 */
const defaultCompare = (
  subject: VersionSubject,
  versions: WorkloadVersion[],
  options: CompareOption[],
): string | null => {
  if (options.some((option) => option.value === 'active')) {
    return 'active';
  }

  if (subject.kind === 'version') {
    const previous = versions.find(
      (version) => version.number < subject.version.number,
    );

    if (previous && options.some((option) => option.value === previous.id)) {
      return previous.id;
    }
  }

  return options[0]?.value ?? null;
};

/**
 * One version opened from the Versions tab: its full configuration, and a
 * comparison computed by the API against the active version or any other
 * version the user picks. A previous version can be rolled back to from
 * here; the rollback itself asks again with a preview.
 */
export const WorkloadVersionDialog = ({
  open,
  onOpenChange,
  workloadId,
  subject,
  versions,
  activeId,
  hasDraft,
  initialTab = 'configuration',
  renderDetails,
  onRollback,
  rollbackDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workloadId: string;
  subject: VersionSubject | null;
  /** The history, newest first. */
  versions: WorkloadVersion[];
  activeId: string | null;
  hasDraft: boolean;
  initialTab?: VersionDialogTab;
  /** The type's read-only view of one config. */
  renderDetails: (config: WorkloadConfig) => ReactNode;
  /** Absent hides the rollback action. */
  onRollback?: (version: WorkloadVersion) => void;
  rollbackDisabled?: boolean;
}) => {
  const { project } = useProject();
  const [tab, setTab] = useState<VersionDialogTab>(initialTab);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const bodyRef = useRef<HTMLElement | null>(null);
  const compareLabelId = useId();

  useEffect(() => {
    bodyRef.current = document.body;
  }, []);

  const subjectKey =
    subject === null
      ? null
      : subject.kind === 'version'
        ? subject.version.id
        : 'draft';

  // A newly opened subject starts on the requested tab and the default side.
  const [openedKey, setOpenedKey] = useState<string | null>(null);

  if (open && subjectKey !== openedKey) {
    setOpenedKey(subjectKey);
    setTab(initialTab);
    setCompareWith(null);
  }

  const options =
    subject === null
      ? []
      : compareOptions(subject, versions, activeId, hasDraft);
  const base =
    compareWith !== null &&
    options.some((option) => option.value === compareWith)
      ? compareWith
      : subject === null
        ? null
        : defaultCompare(subject, versions, options);

  const diff = useVersionDiff(
    project.id,
    workloadId,
    open && tab === 'changes' && subject !== null && base !== null
      ? { kind: 'compare', base, target: subjectKey! }
      : null,
  );

  if (subject === null) {
    return null;
  }

  const version = subject.kind === 'version' ? subject.version : null;
  const status: VersionStatus =
    version === null
      ? 'draft'
      : version.id === activeId
        ? 'active'
        : 'previous';
  const source = version?.source_version_id
    ? versions.find((candidate) => candidate.id === version.source_version_id)
    : undefined;
  const config =
    version?.config ?? (subject as { config: WorkloadConfig }).config;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={bodyRef}
        className="flex max-h-[min(48rem,calc(100vh-4rem))] max-w-2xl flex-col"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>
              {version ? `Version ${version.number}` : 'Pending changes'}
            </DialogTitle>
            <VersionStatusChip status={status} />
          </div>
          <DialogDescription className="text-xs leading-5 tabular-nums">
            {version ? (
              <>
                Applied{' '}
                <time
                  dateTime={version.created_at}
                  title={formatAbsoluteTime(version.created_at)}
                >
                  {formatRelativeTime(version.created_at)}
                </time>
                {version.created_by ? (
                  <>
                    {' '}
                    by{' '}
                    <span
                      className="text-fg-secondary"
                      title={version.created_by.email}
                    >
                      {version.created_by.name}
                    </span>
                  </>
                ) : null}
                {source ? ` · rollback to v${source.number}` : null}
              </>
            ) : (
              'Saved edits that the next deploy applies as a new version.'
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as VersionDialogTab)}
          className="mt-3 flex min-h-0 flex-1 flex-col"
        >
          <TabsList>
            <TabsTrigger value="configuration">
              <SlidersHorizontal aria-hidden="true" strokeWidth={1.75} />
              Configuration
            </TabsTrigger>
            <TabsTrigger value="changes">
              <GitCompareArrows aria-hidden="true" strokeWidth={1.75} />
              Changes
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="configuration"
            className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 pt-4"
          >
            {renderDetails(config)}
          </TabsContent>

          <TabsContent
            value="changes"
            className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 pt-4"
          >
            {base === null ? (
              <p className="text-xs leading-5 text-fg-tertiary">
                There is no other version to compare with yet.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 text-xs text-fg-tertiary">
                  <span id={compareLabelId}>Compared with</span>
                  <Select
                    value={base}
                    items={options}
                    onValueChange={(next) => {
                      if (typeof next === 'string') {
                        setCompareWith(next);
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-labelledby={compareLabelId}
                      className="w-auto min-w-40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {diff.status === 'loading' ? (
                  <VersionDiffSkeleton />
                ) : diff.status === 'error' ? (
                  <VersionDiffError message={diff.message} />
                ) : (
                  <VersionDiffView diff={diff.diff} />
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {version && status === 'previous' && onRollback ? (
            <Button
              type="button"
              variant="outline"
              disabled={rollbackDisabled}
              onClick={() => onRollback(version)}
            >
              <Undo2
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              Roll back to v{version.number}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
