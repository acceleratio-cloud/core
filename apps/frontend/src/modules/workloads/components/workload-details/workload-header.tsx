'use client';

import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { StatusMeter } from '@/modules/workloads/components/workload-cards/node-card-primitives';
import { WorkloadStatusLabel } from '@/modules/workloads/components/workload-status';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { Button } from '@/shared/components/ui/button';

const chipTones: Partial<Record<Workload['status'], string>> = {
  running: 'border-status-success/30 bg-status-success/10',
  failed: 'border-status-danger/40 bg-status-danger/10',
};

/**
 * Who the service is and where it stands: icon tile, name, kind, a status
 * chip and when it last went out. Lives inside the popup as its title.
 */
export const WorkloadHeader = ({
  workload,
  icon,
  kindLabel,
  onClose,
}: {
  workload: Workload;
  icon: ReactNode;
  kindLabel: string;
  onClose: () => void;
}) => {
  const deployedAt = workload.last_deployed_at;

  return (
    <header className="shrink-0 bg-surface-raised px-4 pt-4 pb-3.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-edge-default bg-surface-sunken [&_svg]:size-5.5"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <Dialog.Title
            render={<h2 />}
            title={workload.name}
            className="truncate text-lg leading-tight font-semibold tracking-tight text-fg-primary"
          >
            {workload.name}
          </Dialog.Title>
          <p className="mt-0.5 text-xs text-fg-tertiary">{kindLabel}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close service details"
          onClick={onClose}
          className="-mt-1 -mr-1 shrink-0 text-fg-tertiary"
        >
          <X aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={cn(
            'inline-flex h-6 items-center gap-2 rounded-full border border-edge-default bg-surface-panel px-2.5 text-xs',
            chipTones[workload.status],
          )}
        >
          <StatusMeter status={workload.status} />
          <WorkloadStatusLabel status={workload.status} />
        </span>
        <span className="text-xs text-fg-tertiary tabular-nums">
          {deployedAt ? (
            <time dateTime={deployedAt} title={formatAbsoluteTime(deployedAt)}>
              Deployed {formatRelativeTime(deployedAt)}
            </time>
          ) : (
            'Not deployed yet'
          )}
        </span>
      </div>
    </header>
  );
};
