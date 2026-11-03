'use client';

import { useState } from 'react';
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

type ActionKey = 'deploy' | 'start' | 'stop' | 'restart' | 'delete';

export const WorkloadActions = ({ workload }: { workload: Workload }) => {
  const { project, replaceWorkload, refreshWorkloads } = useProject();
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const isBusy = pendingAction !== null;
  const isDeleting = pendingAction === 'delete';

  const canDeploy = canDeployWorkload(workload.status);
  const canStart = workload.status === 'stopped';
  const canStop =
    workload.status === 'running' || workload.status === 'deploying';
  const canRestart = workload.status === 'running';

  const runAction = async (
    action: Exclude<ActionKey, 'delete'>,
    request: () => Promise<Workload>,
  ) => {
    setPendingAction(action);
    setError(null);

    try {
      replaceWorkload(await request());
    } catch (actionError) {
      setError(getApiErrorMessage(actionError));
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async () => {
    setPendingAction('delete');
    setError(null);

    try {
      await workloadsApi.remove(project.id, workload.id);
      setIsDeleteOpen(false);
      await refreshWorkloads();
    } catch (actionError) {
      setIsDeleteOpen(false);
      setError(getApiErrorMessage(actionError));
    } finally {
      setPendingAction(null);
    }
  };

  const handleDeleteOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDeleting) {
      return;
    }

    setIsDeleteOpen(nextOpen);
  };

  const lifecycle: {
    key: Exclude<ActionKey, 'delete'>;
    visible: boolean;
    primary?: boolean;
    icon: LucideIcon;
    label: string;
    pendingLabel: string;
    request: () => Promise<Workload>;
  }[] = [
    {
      key: 'deploy',
      visible: canDeploy,
      primary: true,
      icon: Rocket,
      label: 'Deploy',
      pendingLabel: 'Deploying',
      request: () => workloadsApi.deploy(project.id, workload.id),
    },
    {
      key: 'start',
      visible: canStart,
      icon: Play,
      label: 'Start',
      pendingLabel: 'Starting',
      request: () => workloadsApi.start(project.id, workload.id),
    },
    {
      key: 'restart',
      visible: canRestart,
      icon: RotateCw,
      label: 'Restart',
      pendingLabel: 'Restarting',
      request: () => workloadsApi.restart(project.id, workload.id),
    },
    {
      key: 'stop',
      visible: canStop,
      icon: Square,
      label: 'Stop',
      pendingLabel: 'Stopping',
      request: () => workloadsApi.stop(project.id, workload.id),
    },
  ];

  return (
    <>
      <div
        role="group"
        aria-label="Service actions"
        className="shrink-0 border-t border-edge-default bg-surface-raised px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          {lifecycle
            .filter((action) => action.visible)
            .map(
              ({ key, primary, icon: Icon, label, pendingLabel, request }) => (
                <Button
                  key={key}
                  type="button"
                  variant={primary ? 'default' : 'outline'}
                  size="sm"
                  loading={pendingAction === key}
                  disabled={isBusy}
                  onClick={() => void runAction(key, request)}
                >
                  <Icon
                    data-icon="inline-start"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                  {pendingAction === key ? pendingLabel : label}
                </Button>
              ),
            )}

          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              setError(null);
              setIsDeleteOpen(true);
            }}
            disabled={isBusy}
            className="ml-auto"
          >
            <Trash2
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            Delete
          </Button>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-2 text-xs leading-relaxed text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>

      <Dialog open={isDeleteOpen} onOpenChange={handleDeleteOpenChange}>
        <DialogContent showCloseButton={!isDeleting}>
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
              onClick={() => setIsDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
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
