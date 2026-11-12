'use client';

import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { StatusMeter } from '@/modules/workloads/components/workload-cards/node-card-primitives';
import { WorkloadStatusLabel } from '@/modules/workloads/components/workload-status';
import { hasPendingChanges } from '@/modules/workloads/utils/workload-config';
import { Button } from '@/shared/components/ui/button';

const chipTones: Partial<Record<Workload['status'], string>> = {
  running: 'border-status-success/30 bg-status-success/10',
  failed: 'border-status-danger/40 bg-status-danger/10',
};

/**
 * Who the service is and what you can do with it: icon tile, name, kind, a
 * status chip and the lifecycle actions. Lives inside the popup as its title.
 */
export const WorkloadHeader = ({
  workload,
  icon,
  kindLabel,
  actions,
  nameControl,
  onClose,
}: {
  workload: Workload;
  /** The icon tile, e.g. the button that changes the icon. */
  icon: ReactNode;
  kindLabel: string;
  /** Lifecycle controls, at the top right beside the title. */
  actions: ReactNode;
  /** Replaces the plain name, e.g. with a button that renames it. */
  nameControl?: ReactNode;
  onClose: () => void;
}) => {
  return (
    <header className="shrink-0 bg-surface-raised px-4 pt-4 pb-3.5">
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1 pt-0.5">
          <Dialog.Title
            render={<h2 />}
            title={workload.name}
            className="-ml-2 truncate pl-2 text-lg flex items-center leading-tight font-semibold tracking-tight text-fg-primary"
          >
            {nameControl ?? workload.name}
            <span
              className={cn(
                'inline-flex mx-2.5 h-6 items-center gap-2 rounded-full border border-edge-default bg-surface-panel px-2.5 text-xs',
                chipTones[workload.status],
              )}
            >
              <StatusMeter status={workload.status} />
              <WorkloadStatusLabel status={workload.status} />
            </span>

            {hasPendingChanges(workload) ? (
              <span className="inline-flex h-5.5 items-center rounded-full font-medium border border-dashed border-status-warning/50 bg-status-warning/10 px-2.5 text-xs text-status-warning">
                Pending changes
              </span>
            ) : null}
          </Dialog.Title>
          <p className="mt-0.5 text-xs text-fg-tertiary">{kindLabel}</p>
        </div>

        <div className="flex max-w-[60%] shrink-0 flex-col items-end gap-1.5 empty:hidden">
          {actions}
        </div>
      </div>
    </header>
  );
};
