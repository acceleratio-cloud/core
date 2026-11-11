'use client';

import { useId, useState } from 'react';
import { HardDrive } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { useProject } from '@/modules/projects/providers/project-provider';
import { formatBytes } from '@/modules/observability/utils/format';
import { VolumeUsageBar } from '@/modules/workloads/components/volume-usage-bar';
import { formatVolumeSize } from '@/modules/workloads/utils/workload-config';
import {
  formatFillPercent,
  serviceVolumeFills,
  type VolumeFill,
} from '@/modules/workloads/utils/volume-usage';
import { Button } from '@/shared/components/ui/button';
import { NodeNotice } from './node-card-primitives';

/** More than this many volumes collapse into a count. */
const VISIBLE_VOLUMES = 3;

/**
 * A disk the service owns, as its own tile attached to the card: its name,
 * how much is used of its size and, with `showFree`, how much is left. Until
 * the kubelet reports it, the tile shows the configured size alone.
 */
export const DiskTile = ({
  label,
  sizeGb,
  fill,
  showFree = false,
}: {
  label: string;
  sizeGb: number;
  fill: VolumeFill | null;
  showFree?: boolean;
}) => (
  <li className="rounded-md border border-border bg-surface-sunken px-2 py-1.5">
    <div className="flex h-5 items-center gap-1.5">
      <HardDrive
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0 text-fg-tertiary"
      />
      <span
        title={label}
        className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
      >
        {label}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {/* With a reading, every number comes from it, so they agree. */}
        {fill
          ? `${formatBytes(fill.usedBytes)} / ${formatBytes(fill.capacityBytes)}`
          : formatVolumeSize(sizeGb)}
      </span>
    </div>
    {fill ? (
      <VolumeUsageBar
        fill={fill}
        label={`${label} usage`}
        className="mt-1 mb-0.5"
      />
    ) : null}
    {fill && showFree ? (
      <p className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{formatBytes(fill.usedBytes)} used</span>
        <span>
          {formatBytes(Math.max(fill.capacityBytes - fill.usedBytes, 0))} free
        </span>
      </p>
    ) : null}
  </li>
);

/** Shown once a disk is at least 85% full; `subject` names it in the text. */
export const DiskFullNotice = ({
  subject,
  fill,
  title = 'Volume almost full',
  more = 0,
}: {
  subject: string;
  fill: VolumeFill;
  title?: string;
  /** Other disks of the card that are also over the threshold. */
  more?: number;
}) => (
  <NodeNotice key={`${subject}-${fill.level}`} tone="warning" title={title}>
    {`${subject} is ${formatFillPercent(fill)} full${
      more > 0 ? `, and ${more} more over 85%` : ''
    }. Once a disk is full, every write to it fails.`}
  </NodeNotice>
);

/**
 * The volumes a service owns, each as its own tile attached to the card, with
 * how full it is and a warning once one is almost full. More than three
 * collapse behind a button that expands the list in place.
 */
export const NodeVolumes = ({ workload }: { workload: Workload }) => {
  const { volumeUsage } = useProject();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const { items, full } = serviceVolumeFills(workload, volumeUsage);
  const hidden = items.length - VISIBLE_VOLUMES;
  const fullest = full[0];

  if (items.length === 0 && !fullest) {
    return null;
  }

  return (
    <>
      {items.length > 0 ? (
        <ul
          id={listId}
          aria-label="Volumes"
          className="mx-3 mb-3 flex flex-col gap-1.5"
        >
          {(expanded ? items : items.slice(0, VISIBLE_VOLUMES)).map(
            ({ volume, fill }) => (
              <DiskTile
                key={volume.id ?? volume.mount_path}
                label={volume.mount_path}
                sizeGb={volume.size_gb}
                fill={fill}
              />
            ),
          )}
          {hidden > 0 ? (
            <li>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-expanded={expanded}
                aria-controls={listId}
                // The card opens the details panel on click; this should not.
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded((value) => !value);
                }}
                className="nodrag nopan text-muted-foreground"
              >
                {expanded
                  ? 'Show fewer volumes'
                  : `+${hidden} more ${hidden === 1 ? 'volume' : 'volumes'}`}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {fullest?.fill ? (
        <DiskFullNotice
          subject={
            fullest.removed
              ? `${fullest.volume.mount_path} (deleted on the next deploy)`
              : fullest.volume.mount_path
          }
          fill={fullest.fill}
          title={
            full.length === 1 ? 'Volume almost full' : 'Volumes almost full'
          }
          more={full.length - 1}
        />
      ) : null}
    </>
  );
};
