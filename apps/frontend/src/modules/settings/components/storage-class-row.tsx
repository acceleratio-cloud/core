import type { StorageClass } from '@acceleratio/shared';
import { Copy, Eye, Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  BINDING_MODE_LABELS,
  CLUSTER_STATUS_LABELS,
} from '../utils/storage-class-form';

type StorageClassRowProps = {
  storageClass: StorageClass;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

const summarize = (storageClass: StorageClass): string[] => {
  const parameters = storageClass.parameters;

  if (!parameters) {
    return ['Settings unavailable'];
  }

  const items = [`Replication ${parameters.replication}`];

  if (parameters.disk_type) {
    items.push(`Disk ${parameters.disk_type}`);
  }

  if (parameters.ttl) {
    items.push(`TTL ${parameters.ttl}`);
  }

  if (storageClass.reclaim_policy) {
    items.push(`Reclaim ${storageClass.reclaim_policy}`);
  }

  if (storageClass.volume_binding_mode) {
    items.push(BINDING_MODE_LABELS[storageClass.volume_binding_mode]);
  }

  items.push(storageClass.allow_volume_expansion ? 'Expandable' : 'Fixed size');

  return items;
};

const volumeLabel = (count: number | null) =>
  count === null ? null : `${count} ${count === 1 ? 'volume' : 'volumes'}`;

export const StorageClassRow = ({
  storageClass,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
}: StorageClassRowProps) => {
  const isPlatform = storageClass.kind === 'platform';
  const status = storageClass.cluster_status;
  const volumes = volumeLabel(storageClass.volume_count);

  return (
    <li className="flex flex-wrap items-start gap-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isPlatform ? (
            <Lock
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
          <p
            title={storageClass.name}
            className="truncate text-sm font-medium text-foreground"
          >
            {storageClass.name}
          </p>
          {storageClass.is_default ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] leading-none font-medium text-muted-foreground">
              Default
            </span>
          ) : null}
          {isPlatform ? (
            <span className="text-[11px] text-muted-foreground">
              Managed by the installer
            </span>
          ) : null}
        </div>

        <p
          title={storageClass.external_name}
          className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
        >
          {storageClass.external_name}
        </p>

        <p className="mt-1.5 text-[13px] text-fg-secondary">
          {summarize(storageClass).join(' · ')}
        </p>

        {storageClass.description ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {storageClass.description}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="flex flex-col items-end gap-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                status === 'ready' && 'bg-status-success',
                status === 'missing' && 'bg-status-danger',
                status === 'drifted' && 'bg-status-warning',
                status === 'unknown' && 'border border-muted-foreground',
              )}
            />
            {CLUSTER_STATUS_LABELS[status]}
          </span>
          {volumes ? <span className="tabular-nums">{volumes}</span> : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${storageClass.name}`}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <MoreHorizontal aria-hidden="true" strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {isPlatform ? (
              <DropdownMenuItem onClick={onView}>
                <Eye aria-hidden="true" strokeWidth={1.75} />
                View settings
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil aria-hidden="true" strokeWidth={1.75} />
                Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={onDuplicate}
              disabled={!storageClass.parameters}
            >
              <Copy aria-hidden="true" strokeWidth={1.75} />
              Duplicate
            </DropdownMenuItem>
            {isPlatform ? null : (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive data-highlighted:text-destructive"
                >
                  <Trash2 aria-hidden="true" strokeWidth={1.75} />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
};
