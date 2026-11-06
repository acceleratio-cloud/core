'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { History, PencilLine, Undo2 } from 'lucide-react';

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
import { useWorkloadActions } from './workload-actions';

type VersionsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; versions: WorkloadVersion[] };

/**
 * Pending changes and the history of applied configs, newest first, with a
 * rollback on every version but the active one. Type-agnostic: the view
 * supplies how one config reads in a row.
 */
export const WorkloadVersions = ({
  renderConfig,
  description,
}: {
  renderConfig: (config: WorkloadConfig) => ReactNode;
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
  const activeId = workload.active_version?.id ?? null;

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

  const numberOf = (id: string | null) =>
    state.kind === 'ready'
      ? state.versions.find((version) => version.id === id)?.number
      : undefined;

  return (
    <DetailStack>
      {hasPendingChanges(workload) && workload.draft_config ? (
        <DetailSection title="Pending changes" icon={PencilLine}>
          <div className="flex items-center gap-4 px-3 py-3">
            <div className="min-w-0 flex-1 text-xs leading-5 text-fg-primary">
              {renderConfig(workload.draft_config)}
              <p className="mt-0.5 text-fg-tertiary">
                Applied by the next deploy.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
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
                <li
                  key={version.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <MonoBadge>v{version.number}</MonoBadge>
                  <div className="min-w-0 flex-1 text-xs leading-5">
                    <div className="truncate text-fg-primary">
                      {renderConfig(version.config)}
                    </div>
                    <p className="text-fg-tertiary tabular-nums">
                      <time
                        dateTime={version.created_at}
                        title={formatAbsoluteTime(version.created_at)}
                      >
                        {formatRelativeTime(version.created_at)}
                      </time>
                      {source !== undefined
                        ? ` · rollback to v${source}`
                        : null}
                    </p>
                  </div>
                  {isActive ? (
                    <span className="shrink-0 rounded-full border border-status-success/30 bg-status-success/10 px-2 text-xs leading-5 text-fg-secondary">
                      Active
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={isRollingBack}
                      disabled={pendingAction !== null}
                      onClick={() => void rollbackTo(version.id)}
                      className="shrink-0"
                    >
                      <Undo2
                        data-icon="inline-start"
                        aria-hidden="true"
                        strokeWidth={1.75}
                      />
                      {isRollingBack ? 'Rolling back' : 'Roll back'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {versionError ? (
          <p
            role="alert"
            className="border-t border-edge-subtle px-3 py-2.5 text-xs leading-relaxed text-destructive"
          >
            {versionError}
          </p>
        ) : null}
      </DetailSection>
    </DetailStack>
  );
};
