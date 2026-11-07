'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { useProject } from '@/modules/projects/providers/project-provider';
import {
  VersionDiffError,
  VersionDiffSkeleton,
  VersionDiffView,
} from '@/modules/workloads/components/workload-details/version-diff';
import {
  useVersionDiff,
  type VersionDiffRequest,
} from '@/modules/workloads/hooks/use-version-diff';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

/**
 * Shows what an apply or a rollback changes and asks before it runs. A change
 * that deletes data needs an extra acknowledgement, and the confirm button
 * turns destructive.
 */
export const VersionChangeConfirmDialog = ({
  open,
  onOpenChange,
  workloadId,
  request,
  revision,
  title,
  description,
  icon: Icon,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workloadId: string;
  request: VersionDiffRequest;
  /** Reloads the comparison when the draft or active version moves. */
  revision?: string | null;
  title: string;
  description: ReactNode;
  icon: LucideIcon;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) => {
  const { project } = useProject();
  const state = useVersionDiff(
    project.id,
    workloadId,
    open ? request : null,
    revision,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  // The panel's portal ignores pointer events, so the dialog mounts on the
  // body to stay clickable.
  const bodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    bodyRef.current = document.body;
  }, []);

  const dataLoss = state.status === 'ready' && state.diff.data_loss;
  const blocked =
    state.status !== 'ready' || (dataLoss && !acknowledged) || pending;

  const handleOpenChange = (next: boolean) => {
    if (!next && pending) {
      return;
    }

    if (!next) {
      setAcknowledged(false);
    }

    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        container={bodyRef}
        showCloseButton={!pending}
        className="flex max-h-[min(44rem,calc(100vh-4rem))] max-w-xl flex-col"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="-mx-6 mt-4 min-h-0 flex-1 overflow-y-auto px-6">
          {state.status === 'loading' ? (
            <VersionDiffSkeleton />
          ) : state.status === 'error' ? (
            <VersionDiffError message={state.message} />
          ) : (
            <VersionDiffView diff={state.diff} />
          )}
        </div>

        {dataLoss ? (
          <label className="mt-4 flex items-start gap-2.5 text-xs leading-5 text-fg-secondary">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              className="mt-0.5"
            />
            I understand that the data in the removed volumes is deleted.
          </label>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 text-xs leading-relaxed text-destructive"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={dataLoss ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={blocked}
            loading={pending}
          >
            <Icon
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
