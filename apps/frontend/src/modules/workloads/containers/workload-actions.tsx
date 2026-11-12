'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Play,
  RotateCw,
  Rocket,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import type { Workload, WorkloadConfig } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { cn } from '@/lib/utils';
import { workloadsApi } from '@/api/workloads';
import { useProject } from '@/modules/projects/providers/project-provider';
import { DetailSection } from '@/modules/workloads/components/workload-details/detail-primitives';
import { deployAction } from '@/modules/workloads/utils/workload-capabilities';
import { hasPendingChanges } from '@/modules/workloads/utils/workload-config';
import { Button } from '@/shared/components/ui/button';
import { VersionChangeConfirmDialog } from './version-change-confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

type LifecycleKey = 'deploy' | 'start' | 'stop' | 'restart';
type ActionKey =
  LifecycleKey | 'delete' | 'rollback' | 'discard' | 'save' | 'rename';

type WorkloadActionsContextValue = {
  workload: Workload;
  pendingAction: ActionKey | null;
  lifecycleError: string | null;
  deleteError: string | null;
  versionError: string | null;
  /** Version id of the rollback in flight. */
  rollbackTarget: string | null;
  /** Resolves true when the action succeeded. */
  runLifecycle: (key: LifecycleKey) => Promise<boolean>;
  /** Resolves true when the rollback succeeded. */
  rollbackTo: (versionId: string) => Promise<boolean>;
  discardDraft: () => Promise<void>;
  /** Stores config edits as the draft. Rejects with the API message. */
  saveConfig: (config: WorkloadConfig) => Promise<void>;
  /** Renames the service in place. Rejects with the API message. */
  renameWorkload: (name: string) => Promise<void>;
  /** Changes the private hostname. Rejects with the API message. */
  updateInternalHostname: (hostname: string) => Promise<void>;
  /** Sets the console icon (null for the default). Rejects with the API message. */
  updateIcon: (icon: string | null) => Promise<void>;
  clearDeleteError: () => void;
  deleteWorkload: () => Promise<void>;
};

const WorkloadActionsContext =
  createContext<WorkloadActionsContextValue | null>(null);

export const useWorkloadActions = () => {
  const context = useContext(WorkloadActionsContext);

  if (!context) {
    throw new Error(
      'Workload actions must be used within a WorkloadActionsProvider',
    );
  }

  return context;
};

/**
 * Owns the in-flight request for one service so the lifecycle buttons in the
 * panel header and the delete button on the Configuration tab disable each
 * other. Key it by workload id to reset its state when the selection changes.
 */
export const WorkloadActionsProvider = ({
  workload,
  children,
}: {
  workload: Workload;
  children: ReactNode;
}) => {
  const { project, replaceWorkload, refreshWorkloads } = useProject();
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);

  const value = useMemo<WorkloadActionsContextValue>(() => {
    const runLifecycle = async (key: LifecycleKey) => {
      setPendingAction(key);
      setLifecycleError(null);

      try {
        replaceWorkload(await workloadsApi[key](project.id, workload.id));
        return true;
      } catch (actionError) {
        setLifecycleError(getApiErrorMessage(actionError));
        return false;
      } finally {
        setPendingAction(null);
      }
    };

    const rollbackTo = async (versionId: string) => {
      setPendingAction('rollback');
      setRollbackTarget(versionId);
      setVersionError(null);

      try {
        replaceWorkload(
          await workloadsApi.rollback(project.id, workload.id, versionId),
        );
        return true;
      } catch (actionError) {
        setVersionError(getApiErrorMessage(actionError));
        return false;
      } finally {
        setPendingAction(null);
        setRollbackTarget(null);
      }
    };

    const discardDraft = async () => {
      setPendingAction('discard');
      setVersionError(null);

      try {
        replaceWorkload(
          await workloadsApi.discardDraft(project.id, workload.id),
        );
      } catch (actionError) {
        setVersionError(getApiErrorMessage(actionError));
      } finally {
        setPendingAction(null);
      }
    };

    const saveConfig = async (config: WorkloadConfig) => {
      setPendingAction('save');

      try {
        replaceWorkload(
          await workloadsApi.update(project.id, workload.id, { config }),
        );
      } catch (actionError) {
        throw new Error(getApiErrorMessage(actionError));
      } finally {
        setPendingAction(null);
      }
    };

    const renameWorkload = async (name: string) => {
      setPendingAction('rename');

      try {
        replaceWorkload(
          await workloadsApi.update(project.id, workload.id, { name }),
        );
      } catch (actionError) {
        throw new Error(getApiErrorMessage(actionError));
      } finally {
        setPendingAction(null);
      }
    };

    const updateInternalHostname = async (hostname: string) => {
      try {
        replaceWorkload(
          await workloadsApi.updateInternalHostname(project.id, workload.id, {
            internal_hostname: hostname,
          }),
        );
      } catch (actionError) {
        throw new Error(getApiErrorMessage(actionError));
      }
    };

    const updateIcon = async (icon: string | null) => {
      try {
        replaceWorkload(
          await workloadsApi.updateIcon(project.id, workload.id, { icon }),
        );
      } catch (actionError) {
        throw new Error(getApiErrorMessage(actionError));
      }
    };

    const deleteWorkload = async () => {
      setPendingAction('delete');
      setDeleteError(null);

      try {
        await workloadsApi.remove(project.id, workload.id);
        await refreshWorkloads();
      } catch (actionError) {
        setDeleteError(getApiErrorMessage(actionError));
      } finally {
        setPendingAction(null);
      }
    };

    return {
      workload,
      pendingAction,
      lifecycleError,
      deleteError,
      versionError,
      rollbackTarget,
      runLifecycle,
      rollbackTo,
      discardDraft,
      saveConfig,
      renameWorkload,
      updateInternalHostname,
      updateIcon,
      clearDeleteError: () => setDeleteError(null),
      deleteWorkload,
    };
  }, [
    workload,
    pendingAction,
    lifecycleError,
    deleteError,
    versionError,
    rollbackTarget,
    project.id,
    replaceWorkload,
    refreshWorkloads,
  ]);

  return (
    <WorkloadActionsContext.Provider value={value}>
      {children}
    </WorkloadActionsContext.Provider>
  );
};

type LifecycleAction = {
  key: LifecycleKey;
  visible: boolean;
  /** A shown action the current status does not allow; it stays in place, dimmed. */
  unavailable?: boolean;
  primary?: boolean;
  icon: LucideIcon;
  /** Colors the icon of an outline button by what the action does. */
  iconTone?: string;
  label: string;
};

/**
 * Deploy, Start, Restart and Stop at the top right of the panel header. Once
 * a service has been deployed, the segmented control always has the same two
 * slots, Start or Restart and Stop, so the row keeps its width and position
 * when the status changes; an action the status does not allow is dimmed
 * instead of removed. Labels never change while a request runs (the button
 * shows a spinner over its label), and the other buttons only ignore clicks
 * during it rather than dimming, so a fast request causes no flicker. The
 * deploy action (Deploy, Apply changes or Redeploy, see `deployAction`) is
 * the one solid button, last in the row.
 * Applying pending changes first shows what they change and asks to confirm.
 * Renders as a fragment so the header can place the buttons and their error.
 * `leading` goes first in the button row, set apart by a divider, for links
 * such as "Logs".
 */
export const WorkloadLifecycleActions = ({
  leading,
}: { leading?: ReactNode } = {}) => {
  const { workload, pendingAction, lifecycleError, runLifecycle } =
    useWorkloadActions();
  const deploy = deployAction(workload);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewsChanges = hasPendingChanges(workload);

  const handleAction = (key: LifecycleKey) => {
    if (pendingAction !== null) {
      return;
    }

    if (key === 'deploy' && reviewsChanges) {
      setReviewOpen(true);
      return;
    }

    void runLifecycle(key);
  };

  const handleApply = async () => {
    if (await runLifecycle('deploy')) {
      setReviewOpen(false);
    }
  };

  // A service never deployed (a first rollout or build) has nothing to start,
  // restart or stop, so it gets no segmented control at all.
  const isDeployed = workload.active_version !== null;
  const isStopped = workload.status === 'stopped';
  const hasControls = isDeployed || isStopped;

  const actions: LifecycleAction[] = [
    {
      key: 'deploy',
      visible: deploy !== null,
      primary: true,
      icon: Rocket,
      label: deploy?.label ?? 'Deploy',
    },
    {
      key: 'start',
      visible: hasControls && isStopped,
      icon: Play,
      iconTone: 'text-status-success',
      label: 'Start',
    },
    {
      key: 'restart',
      visible: hasControls && !isStopped,
      unavailable: workload.status !== 'running',
      icon: RotateCw,
      iconTone: 'text-fg-secondary',
      label: 'Restart',
    },
    {
      key: 'stop',
      visible: hasControls,
      unavailable:
        !isDeployed ||
        (workload.status !== 'running' && workload.status !== 'deploying'),
      icon: Square,
      // Filled, so it reads as a stop glyph rather than an empty checkbox.
      iconTone: 'size-3 fill-current text-status-danger',
      label: 'Stop',
    },
  ];

  const visible = actions.filter((action) => action.visible);
  const controls = visible.filter((action) => !action.primary);
  const primary = visible.find((action) => action.primary);

  if (visible.length === 0 && !leading) {
    return null;
  }

  const renderButton = (
    {
      key,
      primary,
      unavailable,
      icon: Icon,
      iconTone,
      label,
    }: LifecycleAction,
    className?: string,
  ) => (
    <Button
      key={key}
      type="button"
      variant={primary ? 'default' : 'outline'}
      loading={pendingAction === key}
      disabled={unavailable}
      aria-disabled={pendingAction !== null || undefined}
      onClick={() => handleAction(key)}
      className={cn(pendingAction !== null && 'pointer-events-none', className)}
    >
      <Icon
        data-icon="inline-start"
        aria-hidden="true"
        strokeWidth={1.75}
        className={iconTone}
      />
      {label}
    </Button>
  );

  return (
    <>
      <div
        role="group"
        aria-label="Service actions"
        className="flex flex-wrap items-center justify-end gap-2"
      >
        {leading}
        {leading && visible.length > 0 ? (
          <span aria-hidden="true" className="h-5 w-px bg-edge-default" />
        ) : null}
        {controls.length > 0 ? (
          // Joined buttons: shared borders, outer corners only; the focused
          // one rises so its outline is never covered by a neighbour.
          <div className="inline-flex rounded-full shadow-key-soft">
            {controls.map((action) =>
              renderButton(
                action,
                cn(
                  'rounded-none shadow-none first:rounded-l-full last:rounded-r-full not-first:-ml-px focus-visible:z-10',
                  // Start and Restart share a slot; one width for both.
                  action.key !== 'stop' && 'min-w-23',
                ),
              ),
            )}
          </div>
        ) : null}
        {primary ? renderButton(primary) : null}
      </div>

      {lifecycleError && !reviewOpen ? (
        <p
          role="alert"
          className="text-right text-xs leading-relaxed text-destructive"
        >
          {lifecycleError}
        </p>
      ) : null}

      {reviewsChanges || reviewOpen ? (
        <VersionChangeConfirmDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          workloadId={workload.id}
          request={{ kind: 'compare', base: 'active', target: 'draft' }}
          revision={workload.updated_at}
          title="Apply changes"
          description={
            <>
              Review what the next version of {workload.name} changes against v
              {workload.active_version?.number}, then apply it.
            </>
          }
          icon={Rocket}
          confirmLabel="Apply changes"
          pendingLabel="Applying"
          pending={pendingAction === 'deploy'}
          error={reviewOpen ? lifecycleError : null}
          onConfirm={() => void handleApply()}
        />
      ) : null}
    </>
  );
};

/** The Configuration tab's last section: delete, behind a confirmation. */
export const WorkloadDeleteSection = ({
  consequence = 'Removes its Deployment from the cluster.',
}: {
  /** What deleting destroys, in one sentence. */
  consequence?: string;
} = {}) => {
  const {
    workload,
    pendingAction,
    deleteError,
    clearDeleteError,
    deleteWorkload,
  } = useWorkloadActions();
  const [isOpen, setIsOpen] = useState(false);
  // The panel's portal ignores pointer events, and a dialog mounted inside it
  // inherits that, so the confirmation mounts on the body to be clickable.
  const bodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    bodyRef.current = document.body;
  }, []);

  const isDeleting = pendingAction === 'delete';

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDeleting) {
      return;
    }

    setIsOpen(nextOpen);
  };

  const handleConfirm = async () => {
    await deleteWorkload();
    setIsOpen(false);
  };

  return (
    <>
      <DetailSection title="Danger zone">
        <div className="flex items-center gap-4 px-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg-primary">
              Delete this service
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-tertiary">
              {consequence} This cannot be undone.
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pendingAction !== null}
            onClick={() => {
              clearDeleteError();
              setIsOpen(true);
            }}
            className="shrink-0"
          >
            <Trash2
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            Delete
          </Button>
        </div>

        {deleteError ? (
          <p
            role="alert"
            className="border-t border-edge-subtle px-3 py-2.5 text-xs leading-relaxed text-destructive"
          >
            {deleteError}
          </p>
        ) : null}
      </DetailSection>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent container={bodyRef} showCloseButton={!isDeleting}>
          <DialogHeader>
            <DialogTitle>Delete service</DialogTitle>
            <DialogDescription>
              Delete {workload.name}? {consequence} This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirm()}
              loading={isDeleting}
            >
              <Trash2
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              {isDeleting ? 'Deleting' : 'Delete service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
