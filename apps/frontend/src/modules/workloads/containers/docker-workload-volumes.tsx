'use client';

import { useState } from 'react';
import { HardDrive, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';

import type {
  DockerWorkloadConfig,
  DockerWorkloadVolume,
  StorageClass,
} from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
import { formatBytes } from '@/modules/observability/utils/format';
import {
  FILL_TEXT_TONE,
  VolumeUsageBar,
} from '@/modules/workloads/components/volume-usage-bar';
import { DetailSection } from '@/modules/workloads/components/workload-details/detail-primitives';
import { useStorageProfiles } from '@/modules/workloads/hooks/use-storage-profiles';
import {
  effectiveConfig,
  formatVolumeSize,
  removedVolumes,
  volumeChange,
  VOLUMES_MAX,
  type VolumeChange,
} from '@/modules/workloads/utils/workload-config';
import {
  formatFillPercent,
  volumeFill,
  type VolumeFill,
} from '@/modules/workloads/utils/volume-usage';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { useWorkloadActions } from './workload-actions';
import { useBodyRef } from './workload-domain-dialogs';
import {
  AddVolumeDialog,
  EditVolumePathDialog,
  RemoveVolumeDialog,
} from './workload-volume-dialogs';

const MENU_ICON = 'size-3.5 text-fg-tertiary';

const changeLabels: Record<Exclude<VolumeChange, null>, string> = {
  new: 'New',
  moved: 'Path changed',
};

/** The config to save: responses carry env names only, never values. */
const withVolumes = (
  config: DockerWorkloadConfig,
  volumes: DockerWorkloadVolume[],
): DockerWorkloadConfig => {
  // `env` stays out, so the API keeps the stored variables.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { env: _env, env_keys: _keys, ...rest } = config;

  return { ...rest, volumes };
};

const VolumeRow = ({
  volume,
  fill,
  change,
  profile,
  disabled,
  onEdit,
  onRemove,
}: {
  volume: DockerWorkloadVolume;
  fill: VolumeFill | null;
  change: VolumeChange;
  profile: StorageClass | null;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) => {
  const bodyRef = useBodyRef();

  return (
    <li className="flex min-h-14 items-center gap-3 py-2 pr-2 pl-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md border border-edge-default bg-surface-sunken"
      >
        <HardDrive strokeWidth={1.75} className="size-4 text-fg-tertiary" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-mono text-[13px] leading-5 text-fg-primary"
          title={volume.mount_path}
        >
          {volume.mount_path}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-fg-tertiary">
          <span className="font-mono text-fg-secondary tabular-nums">
            {formatVolumeSize(volume.size_gb)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate" title={profile?.name}>
            {profile?.name ?? 'Platform default'}
          </span>
        </p>
        {fill ? (
          <div className="mt-1.5 mb-0.5 flex items-center gap-3">
            <VolumeUsageBar
              fill={fill}
              label={`Volume ${volume.mount_path} usage`}
              className="h-1.5 max-w-64 flex-1"
            />
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                FILL_TEXT_TONE[fill.level],
                fill.level !== 'ok' && 'font-medium',
              )}
            >
              {formatBytes(fill.usedBytes)} used · {formatFillPercent(fill)}
              {fill.level === 'ok' ? null : ' — almost full'}
            </span>
          </div>
        ) : null}
      </div>

      {change ? (
        <span
          title="Applies on the next deploy"
          className="inline-flex shrink-0 items-center gap-1.5 text-xs text-fg-secondary"
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-status-warning"
          />
          {changeLabels[change]}
        </span>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          disabled={disabled}
          aria-label={`Actions for volume ${volume.mount_path}`}
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <MoreHorizontal
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-4 text-fg-secondary"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          container={bodyRef}
          align="end"
          className="w-44 min-w-44"
        >
          <DropdownMenuItem onClick={onEdit}>
            <Pencil
              aria-hidden="true"
              strokeWidth={1.75}
              className={MENU_ICON}
            />
            Change path
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onRemove}
            className="text-destructive data-[highlighted]:bg-destructive/10"
          >
            <Trash2
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5"
            />
            Delete volume
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};

/**
 * Persistent volumes of a Docker service. Unlike domains they are part of the
 * config: each change saves the draft at once and the next deploy creates,
 * moves or deletes the claims. It sits inside the config form; its buttons are
 * `type="button"` and its dialogs stop their submit events.
 */
export const DockerWorkloadVolumes = () => {
  const { workload, pendingAction, saveConfig } = useWorkloadActions();
  const { volumeUsage } = useProject();
  const profiles = useStorageProfiles();
  const config = effectiveConfig(workload);
  const volumes = config.volumes ?? [];
  const removed = removedVolumes(workload);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<DockerWorkloadVolume | null>(null);
  const [removing, setRemoving] = useState<DockerWorkloadVolume | null>(null);
  const isLocked = pendingAction !== null;

  const profileOf = (volume: DockerWorkloadVolume | null) =>
    volume?.storage_class_id && profiles.status === 'ready'
      ? (profiles.profiles.find(({ id }) => id === volume.storage_class_id) ??
        null)
      : null;
  const pathsExcept = (volume: DockerWorkloadVolume | null) =>
    volumes
      .filter(({ id }) => id !== volume?.id)
      .map(({ mount_path }) => mount_path);
  const isDeployed = (volume: DockerWorkloadVolume | null) =>
    !!(
      workload.active_version?.config as DockerWorkloadConfig | undefined
    )?.volumes?.some(({ id }) => id === volume?.id);

  return (
    <>
      <DetailSection
        title="Volumes"
        description="Persistent storage mounted into every replica. A full volume rejects every write, so leave headroom. With volumes, deploys and restarts stop the old pods before new ones start, so the service pauses briefly. Changes apply on the next deploy."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLocked || volumes.length >= VOLUMES_MAX}
            title={
              volumes.length >= VOLUMES_MAX
                ? `Up to ${VOLUMES_MAX} volumes per service.`
                : undefined
            }
            onClick={() => setAddOpen(true)}
          >
            <Plus
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            Add volume
          </Button>
        }
      >
        {volumes.length > 0 ? (
          <ul className="divide-y divide-edge-subtle">
            {volumes.map((volume) => (
              <VolumeRow
                key={volume.id}
                volume={volume}
                fill={volumeFill(
                  volume.size_gb,
                  volume.id ? volumeUsage.get(volume.id) : undefined,
                )}
                change={volumeChange(workload, volume)}
                profile={profileOf(volume)}
                disabled={isLocked}
                onEdit={() => setEditing(volume)}
                onRemove={() => setRemoving(volume)}
              />
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 px-3 py-3.5">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-edge-default bg-surface-sunken"
            >
              <HardDrive
                strokeWidth={1.75}
                className="size-4 text-fg-tertiary"
              />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] leading-5 text-fg-primary">
                No volumes
              </p>
              <p className="text-xs leading-5 text-fg-tertiary">
                Files the service writes are lost when it restarts.
              </p>
            </div>
          </div>
        )}

        {removed.length > 0 ? (
          <p
            role="status"
            className="border-t border-edge-subtle px-3 py-2.5 text-xs leading-5 text-fg-secondary"
          >
            The next deploy deletes{' '}
            {removed.map((volume, index) => (
              <span key={volume.id}>
                {index > 0 ? ', ' : null}
                <code className="font-mono text-fg-primary">
                  {volume.mount_path}
                </code>
              </span>
            ))}{' '}
            and {removed.length === 1 ? 'its data' : 'their data'}. Discard the
            pending changes to keep {removed.length === 1 ? 'it' : 'them'}.
          </p>
        ) : null}
      </DetailSection>

      <AddVolumeDialog
        key={`add-${addOpen}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        takenPaths={pathsExcept(null)}
        profiles={profiles}
        onAdd={(volume) =>
          saveConfig(withVolumes(config, [...volumes, volume]))
        }
      />
      <EditVolumePathDialog
        key={`edit-${editing?.id ?? 'closed'}`}
        volume={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        takenPaths={pathsExcept(editing)}
        profile={profileOf(editing)}
        onSave={(mountPath) =>
          saveConfig(
            withVolumes(
              config,
              volumes.map((volume) =>
                volume.id === editing?.id
                  ? { ...volume, mount_path: mountPath }
                  : volume,
              ),
            ),
          )
        }
      />
      <RemoveVolumeDialog
        key={`remove-${removing?.id ?? 'closed'}`}
        volume={removing}
        deployed={isDeployed(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        onRemove={() =>
          saveConfig(
            withVolumes(
              config,
              volumes.filter(({ id }) => id !== removing?.id),
            ),
          )
        }
      />
    </>
  );
};
