'use client';

import { useState } from 'react';
import {
  LoaderCircle,
  Play,
  RotateCw,
  Rocket,
  Square,
  Trash2,
} from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { useProject } from '@/modules/projects/providers/project-provider';
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

  const canDeploy =
    workload.status === 'draft' ||
    workload.status === 'failed' ||
    workload.status === 'stopped';
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

  return (
    <>
      <div
        role="group"
        aria-label="Service actions"
        className="shrink-0 border-t border-border px-6 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          {canDeploy ? (
            <Button
              type="button"
              size="sm"
              onClick={() =>
                void runAction('deploy', () =>
                  workloadsApi.deploy(project.id, workload.id),
                )
              }
              disabled={isBusy}
              aria-busy={pendingAction === 'deploy'}
            >
              {pendingAction === 'deploy' ? (
                <LoaderCircle
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Rocket aria-hidden="true" strokeWidth={1.75} />
              )}
              {pendingAction === 'deploy' ? 'Deploying...' : 'Deploy'}
            </Button>
          ) : null}

          {canStart ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void runAction('start', () =>
                  workloadsApi.start(project.id, workload.id),
                )
              }
              disabled={isBusy}
              aria-busy={pendingAction === 'start'}
            >
              {pendingAction === 'start' ? (
                <LoaderCircle
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Play aria-hidden="true" strokeWidth={1.75} />
              )}
              {pendingAction === 'start' ? 'Starting...' : 'Start'}
            </Button>
          ) : null}

          {canStop ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void runAction('stop', () =>
                  workloadsApi.stop(project.id, workload.id),
                )
              }
              disabled={isBusy}
              aria-busy={pendingAction === 'stop'}
            >
              {pendingAction === 'stop' ? (
                <LoaderCircle
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Square aria-hidden="true" strokeWidth={1.75} />
              )}
              {pendingAction === 'stop' ? 'Stopping...' : 'Stop'}
            </Button>
          ) : null}

          {canRestart ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void runAction('restart', () =>
                  workloadsApi.restart(project.id, workload.id),
                )
              }
              disabled={isBusy}
              aria-busy={pendingAction === 'restart'}
            >
              {pendingAction === 'restart' ? (
                <LoaderCircle
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <RotateCw aria-hidden="true" strokeWidth={1.75} />
              )}
              {pendingAction === 'restart' ? 'Restarting...' : 'Restart'}
            </Button>
          ) : null}

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
            <Trash2 aria-hidden="true" strokeWidth={1.75} />
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
              disabled={isDeleting}
              aria-busy={isDeleting}
            >
              {isDeleting ? (
                <LoaderCircle
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Trash2 aria-hidden="true" strokeWidth={1.75} />
              )}
              {isDeleting ? 'Deleting...' : 'Delete service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
