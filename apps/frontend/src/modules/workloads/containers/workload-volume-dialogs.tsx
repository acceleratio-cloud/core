'use client';

import { useId, useState } from 'react';
import { ChevronRight, HardDrive, Plus, Trash2 } from 'lucide-react';

import type { DockerWorkloadVolume, StorageClass } from '@acceleratio/shared';
import type { StorageProfilesState } from '@/modules/workloads/hooks/use-storage-profiles';
import {
  cleanMountPath,
  DEFAULT_VOLUME_SIZE,
  formatVolumeSize,
  mountPathProblem,
  VOLUME_SIZE_MAX,
  VOLUME_SIZE_MIN,
} from '@/modules/workloads/utils/workload-config';
import { Button } from '@/shared/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Slider } from '@/shared/components/ui/slider';
import { DialogShell, SubmitError } from './workload-domain-dialogs';

/** The settings of a profile, in one short line. */
const describeStorageProfile = ({ parameters }: StorageClass): string => {
  if (!parameters) {
    return 'Settings unavailable.';
  }

  const copies = parameters.number_of_replicas;
  const parts = [
    copies === 1 ? 'One copy' : `${copies} copies on different servers`,
    parameters.disk_selector
      ? `${parameters.disk_selector.join(', ')} disks`
      : null,
  ].filter(Boolean);

  return `${parts.join(', ')}.`;
};

const DEPLOY_NOTE = 'Saved as a pending change; Deploy applies it.';

const clampSize = (value: number) =>
  Math.min(VOLUME_SIZE_MAX, Math.max(VOLUME_SIZE_MIN, Math.round(value)));

/**
 * Dialogs render inside the config form in the React tree, and React submit
 * events bubble through portals, so each form stops its own.
 */
const handleSubmit =
  (submit: () => Promise<void>) =>
  (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    void submit();
  };

/** The path a volume is mounted at inside the container. */
const MountPathField = ({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) => (
  <Field data-invalid={error ? true : undefined}>
    <FieldLabel htmlFor={id}>Mount path</FieldLabel>
    <Input
      id={id}
      autoComplete="off"
      autoFocus
      spellCheck={false}
      placeholder="/data"
      value={value}
      aria-invalid={!!error}
      onChange={(event) => onChange(event.target.value)}
      className="font-mono"
    />
    <FieldDescription>
      Absolute path inside the container. Every replica mounts the same data.
    </FieldDescription>
    <FieldError errors={error ? [{ message: error }] : []} />
  </Field>
);

/** The size the field holds, or null while it is not a whole 1–100. */
export const parseSize = (text: string): number | null => {
  const trimmed = text.trim();
  const parsed = Number(trimmed);

  return trimmed !== '' &&
    Number.isInteger(parsed) &&
    parsed >= VOLUME_SIZE_MIN &&
    parsed <= VOLUME_SIZE_MAX
    ? parsed
    : null;
};

export const SIZE_ERROR = `Enter a whole number of GiB from ${VOLUME_SIZE_MIN} to ${VOLUME_SIZE_MAX}.`;

/**
 * Size in GiB: a slider for the rough value and a number field for an exact
 * one. The dialog submits only what the field shows: an out-of-range or
 * partial value blocks the submit instead of falling back to an older one.
 */
export const SizeField = ({
  text,
  onTextChange,
  error,
}: {
  text: string;
  onTextChange: (text: string) => void;
  error: string | null;
}) => {
  const labelId = useId();
  const inputId = useId();
  const parsed = Number(text);
  // The slider follows the field; while the field is not a valid size it
  // shows the nearest one.
  const sliderValue = Number.isFinite(parsed)
    ? clampSize(parsed)
    : DEFAULT_VOLUME_SIZE;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel id={labelId} htmlFor={inputId}>
        Maximum size
      </FieldLabel>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <Slider
            aria-labelledby={labelId}
            value={sliderValue}
            min={VOLUME_SIZE_MIN}
            max={VOLUME_SIZE_MAX}
            step={1}
            onValueChange={(next) =>
              onTextChange(
                String(clampSize(Array.isArray(next) ? next[0] : next)),
              )
            }
          />
          <div
            aria-hidden="true"
            className="mt-1.5 flex justify-between font-mono text-[11px] leading-4 text-fg-tertiary tabular-nums"
          >
            <span>{formatVolumeSize(VOLUME_SIZE_MIN)}</span>
            <span>{formatVolumeSize(VOLUME_SIZE_MAX)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 self-start">
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={VOLUME_SIZE_MIN}
            max={VOLUME_SIZE_MAX}
            step={1}
            value={text}
            aria-invalid={!!error}
            onChange={(event) => onTextChange(event.target.value)}
            className="w-20 text-right font-mono tabular-nums"
          />
          <span className="text-xs text-fg-tertiary">GiB</span>
        </div>
      </div>
      <FieldDescription>
        {VOLUME_SIZE_MIN}–{VOLUME_SIZE_MAX} GiB, fixed once the volume exists. A
        limit, not reserved space: volumes share the free disk of the storage
        servers. When a volume is full, every write fails and the file being
        written can be lost.
      </FieldDescription>
      <FieldError errors={error ? [{ message: error }] : []} />
    </Field>
  );
};

/** Storage profile behind Advanced; null keeps the platform profile. */
export const ProfileField = ({
  profiles,
  value,
  onChange,
}: {
  profiles: StorageProfilesState;
  value: string | null;
  onChange: (value: string | null) => void;
}) => {
  const selectId = useId();
  // Deleting a volume must delete its data, which a Retain profile keeps.
  const available =
    profiles.status === 'ready'
      ? profiles.profiles.filter(
          (profile) => profile.reclaim_policy !== 'Retain',
        )
      : [];
  const platform = available.find((profile) => profile.kind === 'platform');
  const selectedId = value ?? platform?.id ?? null;
  const selected = available.find((profile) => profile.id === selectedId);

  return (
    <details className="group border-t border-border pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-foreground outline-none focus-visible:underline">
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        Advanced settings
        <span className="truncate font-normal text-muted-foreground">
          {selected ? selected.name : 'Platform default'}
        </span>
      </summary>

      <Field className="mt-4">
        <FieldLabel htmlFor={selectId}>Storage profile</FieldLabel>
        {profiles.status === 'error' ? (
          <FieldDescription className="text-destructive">
            Could not load storage profiles: {profiles.message}. The volume will
            use the platform default.
          </FieldDescription>
        ) : (
          <>
            <Select
              value={selectedId}
              items={available.map((profile) => ({
                value: profile.id,
                label: profile.name,
              }))}
              disabled={profiles.status === 'loading'}
              onValueChange={(next) => {
                if (typeof next === 'string') {
                  onChange(next === platform?.id ? null : next);
                }
              }}
            >
              <SelectTrigger id={selectId}>
                <SelectValue placeholder="Loading profiles…" />
              </SelectTrigger>
              <SelectContent>
                {available.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {selected
                ? describeStorageProfile(selected)
                : 'Copies, disks and placement of the stored data.'}{' '}
              Fixed once the volume exists. Profiles that keep data after
              deletion are not offered.
            </FieldDescription>
          </>
        )}
      </Field>
    </details>
  );
};

/** Adds a volume to the pending changes. */
export const AddVolumeDialog = ({
  open,
  onOpenChange,
  takenPaths,
  profiles,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  takenPaths: string[];
  profiles: StorageProfilesState;
  /** Rejects with a message the dialog shows. */
  onAdd: (volume: DockerWorkloadVolume) => Promise<void>;
}) => {
  const pathId = useId();
  const [path, setPath] = useState('');
  const [sizeText, setSizeText] = useState(String(DEFAULT_VOLUME_SIZE));
  const [profileId, setProfileId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathError = mountPathProblem(path, takenPaths);
  const size = parseSize(sizeText);
  const sizeError = size === null ? SIZE_ERROR : null;

  const submit = async () => {
    setTouched(true);

    if (pathError || size === null) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onAdd({
        mount_path: cleanMountPath(path),
        size_gb: size,
        storage_class_id: profileId,
      });
      onOpenChange(false);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={open} busy={busy} onOpenChange={onOpenChange}>
      <form noValidate onSubmit={handleSubmit(submit)}>
        <DialogHeader>
          <DialogTitle>Add volume</DialogTitle>
          <DialogDescription>
            Persistent storage that survives restarts and deploys. {DEPLOY_NOTE}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 flex flex-col gap-5">
          <MountPathField
            id={pathId}
            value={path}
            onChange={setPath}
            error={touched ? pathError : null}
          />
          <SizeField
            text={sizeText}
            onTextChange={setSizeText}
            error={touched ? sizeError : null}
          />
          <ProfileField
            profiles={profiles}
            value={profileId}
            onChange={setProfileId}
          />
        </div>

        <SubmitError error={error} />

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            <Plus
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            {busy ? 'Adding' : 'Add volume'}
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
};

/** Moves a volume to another path. Size and profile only show. */
export const EditVolumePathDialog = ({
  volume,
  onOpenChange,
  takenPaths,
  profile,
  onSave,
}: {
  volume: DockerWorkloadVolume | null;
  onOpenChange: (open: boolean) => void;
  takenPaths: string[];
  profile: StorageClass | null;
  /** Rejects with a message the dialog shows. */
  onSave: (mountPath: string) => Promise<void>;
}) => {
  const pathId = useId();
  const [path, setPath] = useState(volume?.mount_path ?? '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathError = mountPathProblem(path, takenPaths);

  const submit = async () => {
    setTouched(true);

    if (pathError || volume === null) {
      return;
    }

    if (cleanMountPath(path) === volume.mount_path) {
      onOpenChange(false);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onSave(cleanMountPath(path));
      onOpenChange(false);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={volume !== null} busy={busy} onOpenChange={onOpenChange}>
      <form noValidate onSubmit={handleSubmit(submit)}>
        <DialogHeader>
          <DialogTitle>Change mount path</DialogTitle>
          <DialogDescription>
            The data stays; only where the container sees it changes.{' '}
            {DEPLOY_NOTE}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 flex flex-col gap-5">
          <MountPathField
            id={pathId}
            value={path}
            onChange={setPath}
            error={touched ? pathError : null}
          />
          {volume ? (
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1.5 rounded-md border border-edge-subtle bg-surface-sunken px-3 py-2.5 text-xs">
              <dt className="text-fg-tertiary">Maximum size</dt>
              <dd className="font-mono text-fg-primary tabular-nums">
                {formatVolumeSize(volume.size_gb)}
              </dd>
              <dt className="text-fg-tertiary">Storage profile</dt>
              <dd
                className="truncate text-fg-primary"
                title={profile?.name ?? undefined}
              >
                {profile?.name ?? 'Platform default'}
              </dd>
            </dl>
          ) : null}
        </div>

        <SubmitError error={error} />

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? 'Saving' : 'Save path'}
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
};

/** Drops a volume from the pending changes; its data goes on deploy. */
export const RemoveVolumeDialog = ({
  volume,
  deployed,
  onOpenChange,
  onRemove,
}: {
  volume: DockerWorkloadVolume | null;
  /** True when the running version has the volume, so it holds data. */
  deployed: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rejects with a message the dialog shows. */
  onRemove: () => Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);

    try {
      await onRemove();
      onOpenChange(false);
    } catch (removeError) {
      setError((removeError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={volume !== null} busy={busy} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Delete volume</DialogTitle>
        <DialogDescription>
          <code className="font-mono">{volume?.mount_path}</code> is unmounted
          {deployed
            ? ' and every file on it is deleted on the next deploy. This cannot be undone.'
            : '. It was never deployed, so it holds no data.'}
        </DialogDescription>
      </DialogHeader>

      {volume ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-fg-tertiary">
          <HardDrive
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-3.5"
          />
          <span className="font-mono tabular-nums">
            {formatVolumeSize(volume.size_gb)}
          </span>
        </p>
      ) : null}

      <SubmitError error={error} />

      <DialogFooter className="mt-5">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          loading={busy}
          onClick={() => void remove()}
        >
          <Trash2
            data-icon="inline-start"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          {busy ? 'Deleting' : 'Delete volume'}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
};
