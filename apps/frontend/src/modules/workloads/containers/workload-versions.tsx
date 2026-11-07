'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  GitCompareArrows,
  PencilLine,
  Undo2,
} from 'lucide-react';

import type { WorkloadConfig, WorkloadVersion } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { useProject } from '@/modules/projects/providers/project-provider';
import {
  DetailSection,
  DetailStack,
  MonoBadge,
} from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { hasPendingChanges } from '@/modules/workloads/utils/workload-config';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { VersionChangeConfirmDialog } from './version-change-confirm-dialog';
import { useWorkloadActions } from './workload-actions';
import {
  VersionStatusChip,
  WorkloadVersionDialog,
  type VersionDialogTab,
} from './workload-version-dialog';

type VersionsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; versions: WorkloadVersion[] };

type Viewing =
  | { kind: 'version'; id: string; tab: VersionDialogTab }
  | { kind: 'draft'; tab: VersionDialogTab };

/**
 * Pending changes and the history of applied configs, newest first. Any row
 * opens the version's full configuration and a comparison with the active
 * version or another one; a rollback first previews what it changes.
 * Type-agnostic: the view supplies how one config reads in a row and in
 * full.
 */
export const WorkloadVersions = ({
  renderConfig,
  renderDetails,
  description,
}: {
  renderConfig: (config: WorkloadConfig) => ReactNode;
  /** The full, read-only view of one config in the version dialog. */
  renderDetails: (config: WorkloadConfig) => ReactNode;
  /** What a rollback does for this type, under the section title. */
  description?: ReactNode;
}) => {
  const { project } = useProject();
  const {
    workload,
    pendingAction,
    versionError,
    rollbackTarget,
    rollbackTo,
    discardDraft,
  } = useWorkloadActions();
  const [state, setState] = useState<VersionsState>({ kind: 'loading' });
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirming, setConfirming] = useState<WorkloadVersion | null>(null);
  const activeId = workload.active_version?.id ?? null;
  const pending = hasPendingChanges(workload) && workload.draft_config !== null;

  // A deploy or rollback moves the active version; reload the history then.
  useEffect(() => {
    let cancelled = false;

    workloadsApi
      .listVersions(project.id, workload.id)
      .then((versions) => {
        if (!cancelled) {
          setState({ kind: 'ready', versions });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: 'error', message: getApiErrorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project.id, workload.id, activeId]);

  const versions = state.kind === 'ready' ? state.versions : [];
  const numberOf = (id: string | null) =>
    versions.find((version) => version.id === id)?.number;

  const open = (next: Viewing) => {
    setViewing(next);
    setDialogOpen(true);
  };

  const viewedVersion =
    viewing?.kind === 'version'
      ? versions.find((version) => version.id === viewing.id)
      : undefined;
  const subject =
    viewing?.kind === 'draft' && workload.draft_config
      ? { kind: 'draft' as const, config: workload.draft_config }
      : viewedVersion
        ? { kind: 'version' as const, version: viewedVersion }
        : null;

  const startRollback = (version: WorkloadVersion) => {
    setDialogOpen(false);
    setConfirming(version);
  };

  const confirmRollback = async () => {
    if (confirming && (await rollbackTo(confirming.id))) {
      setConfirming(null);
    }
  };

  return (
    <DetailStack>
      {pending ? (
        <DetailSection title="Pending changes" icon={PencilLine}>
          <div className="flex items-center gap-3 px-3 py-3">
            <div className="min-w-0 flex-1 text-xs leading-5 text-fg-primary">
              <div className="truncate">
                {renderConfig(workload.draft_config!)}
              </div>
              <p className="mt-0.5 text-fg-tertiary">
                Applied by the next deploy.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => open({ kind: 'draft', tab: 'changes' })}
              className="shrink-0"
            >
              <GitCompareArrows
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              Review
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={pendingAction === 'discard'}
              disabled={pendingAction !== null}
              onClick={() => void discardDraft()}
              className="shrink-0"
            >
              {pendingAction === 'discard' ? 'Discarding' : 'Discard'}
            </Button>
          </div>
        </DetailSection>
      ) : null}

      <DetailSection title="Versions" description={description}>
        {state.kind === 'loading' ? (
          <div className="flex flex-col gap-2 px-3 py-3" aria-busy="true">
            <span className="sr-only">Loading versions</span>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : state.kind === 'error' ? (
          <p
            role="alert"
            className="px-3 py-3 text-xs leading-relaxed text-destructive"
          >
            {state.message}
          </p>
        ) : state.versions.length === 0 ? (
          <p className="px-3 py-3 text-xs leading-relaxed text-fg-tertiary">
            No versions yet. The first deploy creates v1.
          </p>
        ) : (
          <ol className="divide-y divide-edge-subtle">
            {state.versions.map((version) => {
              const isActive = version.id === activeId;
              const isRollingBack = rollbackTarget === version.id;
              const source = numberOf(version.source_version_id);

              return (
                <li key={version.id} className="flex items-center gap-2 pr-3">
                  <button
                    type="button"
                    onClick={() =>
                      open({
                        kind: 'version',
                        id: version.id,
                        tab: 'configuration',
                      })
                    }
                    aria-label={`Open v${version.number}`}
                    className="group flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left outline-none transition-colors hover:bg-surface-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset motion-reduce:transition-none"
                  >
                    <MonoBadge>v{version.number}</MonoBadge>
                    <div className="min-w-0 flex-1 text-xs leading-5">
                      <div className="truncate text-fg-primary">
                        {renderConfig(version.config)}
                      </div>
                      <p className="truncate text-fg-tertiary tabular-nums">
                        <time
                          dateTime={version.created_at}
                          title={formatAbsoluteTime(version.created_at)}
                        >
                          {formatRelativeTime(version.created_at)}
                        </time>
                        {version.created_by ? (
                          <span title={version.created_by.email}>
                            {` · ${version.created_by.name}`}
                          </span>
                        ) : null}
                        {source !== undefined
                          ? ` · rollback to v${source}`
                          : null}
                      </p>
                    </div>
                    <ChevronRight
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-3.5 shrink-0 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                    />
                  </button>
                  {isActive ? (
                    <VersionStatusChip status="active" />
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          open({
                            kind: 'version',
                            id: version.id,
                            tab: 'changes',
                          })
                        }
                        aria-label={`Compare v${version.number} with the active version`}
                        className="shrink-0"
                      >
                        <GitCompareArrows
                          data-icon="inline-start"
                          aria-hidden="true"
                          strokeWidth={1.75}
                        />
                        Compare
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={isRollingBack}
                        disabled={pendingAction !== null}
                        onClick={() => startRollback(version)}
                        className="shrink-0"
                      >
                        <Undo2
                          data-icon="inline-start"
                          aria-hidden="true"
                          strokeWidth={1.75}
                        />
                        {isRollingBack ? 'Rolling back' : 'Roll back'}
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {versionError && confirming === null ? (
          <p
            role="alert"
            className="border-t border-edge-subtle px-3 py-2.5 text-xs leading-relaxed text-destructive"
          >
            {versionError}
          </p>
        ) : null}
      </DetailSection>

      <WorkloadVersionDialog
        open={dialogOpen && subject !== null}
        onOpenChange={setDialogOpen}
        workloadId={workload.id}
        subject={subject}
        versions={versions}
        activeId={activeId}
        hasDraft={pending}
        initialTab={viewing?.tab}
        renderDetails={renderDetails}
        onRollback={startRollback}
        rollbackDisabled={pendingAction !== null}
      />

      <VersionChangeConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) {
            setConfirming(null);
          }
        }}
        workloadId={workload.id}
        request={
          confirming ? { kind: 'rollback', versionId: confirming.id } : null
        }
        revision={activeId}
        title={`Roll back to v${confirming?.number ?? ''}`}
        description={
          <>
            Applies the configuration of v{confirming?.number} as a new version.
            Pending changes stay for a later deploy.
          </>
        }
        icon={Undo2}
        confirmLabel="Roll back"
        pendingLabel="Rolling back"
        pending={pendingAction === 'rollback'}
        error={confirming ? versionError : null}
        onConfirm={() => void confirmRollback()}
      />
    </DetailStack>
  );
};
