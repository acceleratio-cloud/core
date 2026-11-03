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

import type { Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { useProject } from '@/modules/projects/providers/project-provider';
import { DetailSection } from '@/modules/workloads/components/workload-details/detail-primitives';
import { canDeployWorkload } from '@/modules/workloads/utils/workload-capabilities';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

type LifecycleKey = 'deploy' | 'start' | 'stop' | 'restart';
type ActionKey = LifecycleKey | 'delete';

type WorkloadActionsContextValue = {
  workload: Workload;
  pendingAction: ActionKey | null;
  lifecycleError: string | null;
  deleteError: string | null;
  runLifecycle: (key: LifecycleKey) => Promise<void>;
  clearDeleteError: () => void;
  deleteWorkload: () => Promise<void>;
};

const WorkloadActionsContext =
  createContext<WorkloadActionsContextValue | null>(null);

const useWorkloadActions = () => {
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

  const value = useMemo<WorkloadActionsContextValue>(() => {
    const runLifecycle = async (key: LifecycleKey) => {
      setPendingAction(key);
      setLifecycleError(null);

      try {
        replaceWorkload(await workloadsApi[key](project.id, workload.id));
      } catch (actionError) {
        setLifecycleError(getApiErrorMessage(actionError));
      } finally {
        setPendingAction(null);
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
      runLifecycle,
      clearDeleteError: () => setDeleteError(null),
      deleteWorkload,
    };
  }, [
    workload,
    pendingAction,
    lifecycleError,
    deleteError,
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
  primary?: boolean;
  icon: LucideIcon;
  label: string;
  pendingLabel: string;
};

/**
 * Deploy, Start, Restart and Stop for the panel header. Only the actions the
 * current status allows are shown, and Deploy is the only filled button.
 * Renders as a fragment so the header can place the group and its error.
 */
export const WorkloadLifecycleActions = () => {
  const { workload, pendingAction, lifecycleError, runLifecycle } =
    useWorkloadActions();

  const actions: LifecycleAction[] = [
    {
      key: 'deploy',
      visible: canDeployWorkload(workload.status),
      primary: true,
      icon: Rocket,
      label: 'Deploy',
      pendingLabel: 'Deploying',
    },
    {
      key: 'start',
      visible: workload.status === 'stopped',
      icon: Play,
      label: 'Start',
      pendingLabel: 'Starting',
    },
    {
      key: 'restart',
      visible: workload.status === 'running',
      icon: RotateCw,
      label: 'Restart',
      pendingLabel: 'Restarting',
    },
    {
      key: 'stop',
      visible: workload.status === 'running' || workload.status === 'deploying',
      icon: Square,
      label: 'Stop',
      pendingLabel: 'Stopping',
    },
  ];

  return (
    <>
      <div
        role="group"
        aria-label="Service actions"
        className="ml-auto flex flex-wrap items-center gap-2"
      >
        {actions
          .filter((action) => action.visible)
          .map(({ key, primary, icon: Icon, label, pendingLabel }) => (
            <Button
              key={key}
              type="button"
              variant={primary ? 'default' : 'outline'}
              size="sm"
              loading={pendingAction === key}
              disabled={pendingAction !== null}
              onClick={() => void runLifecycle(key)}
            >
              <Icon
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              {pendingAction === key ? pendingLabel : label}
            </Button>
          ))}
      </div>

      {lifecycleError ? (
        <p
          role="alert"
          className="basis-full text-xs leading-relaxed text-destructive"
        >
          {lifecycleError}
        </p>
      ) : null}
    </>
  );
};

/** The Configuration tab's last section: delete, behind a confirmation. */
export const WorkloadDeleteSection = () => {
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
      <DetailSection title="Danger zone" icon={Trash2}>
        <div className="flex items-center gap-4 px-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg-primary">
              Delete this service
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-tertiary">
              Removes its Deployment from the cluster. This cannot be undone.
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
              Delete {workload.name}? This removes its Deployment from the
              cluster. This cannot be undone.
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
