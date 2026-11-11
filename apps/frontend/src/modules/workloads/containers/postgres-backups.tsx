'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { DatabaseBackup, History } from 'lucide-react';

import type {
  PostgresBackup,
  PostgresBackups,
  PostgresConfig,
  Workload,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { postgresApi } from '@/api/workloads/postgres';
import { useProject } from '@/modules/projects/providers/project-provider';
import {
  DetailNotice,
  DetailSection,
  DetailStack,
  PropertyList,
  PropertyRow,
} from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  formatAbsoluteTime,
  formatPreciseTime,
} from '@/modules/workloads/utils/format-time';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Switch } from '@/shared/components/ui/switch';
import { useBody } from './postgres-access';

/** Re-read while something is still moving: setup or a running backup. */
const POLL_MS = 5000;

const STATE_LABEL: Record<PostgresBackups['state'], string> = {
  off: 'Off',
  provisioning: 'Setting up',
  active: 'Active',
  failing: 'Failing',
};

const RETENTION_LABEL: Record<string, string> = { '7d': '7 days' };

const PHASE_LABEL: Record<string, string> = {
  completed: 'Completed',
  failed: 'Failed',
  running: 'Running',
  started: 'Running',
  pending: 'Pending',
};

const isMoving = (backups: PostgresBackups) =>
  backups.state === 'provisioning' ||
  backups.backups.some((backup) => !['completed', 'failed'].includes(backup.phase));

/** A `datetime-local` value (local time, to the second) for an ISO time. */
const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 19);
};

/**
 * Continuous backups of a database: WAL is archived as it is written and a
 * base backup runs daily, so any second of the retention window can be
 * restored into a new database.
 */
export const PostgresBackupsPanel = ({ workload }: { workload: Workload }) => {
  const [backups, setBackups] = useState<PostgresBackups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [toggling, setToggling] = useState(false);
  const { replaceWorkload } = useProject();
  const body = useBody();
  const switchId = useId();

  const load = useCallback(
    () =>
      postgresApi
        .backups(workload.project_id, workload.id)
        .then((loaded) => {
          setBackups(loaded);
          setError(null);
        })
        .catch((loadError) => setError(getApiErrorMessage(loadError))),
    [workload.project_id, workload.id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const moving = backups !== null && isMoving(backups);

  useEffect(() => {
    if (!moving) {
      return;
    }

    const timer = setInterval(() => void load(), POLL_MS);

    return () => clearInterval(timer);
  }, [moving, load]);

  const backUpNow = async () => {
    setBusy(true);
    setError(null);

    try {
      setBackups(await postgresApi.backUp(workload.project_id, workload.id));
    } catch (backUpError) {
      setError(getApiErrorMessage(backUpError));
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    setToggling(true);
    setError(null);

    try {
      replaceWorkload(
        await workloadsApi.update(workload.project_id, workload.id, {
          // The API keeps every field as it is except `backups`.
          config: {
            ...(workload.active_version?.config as PostgresConfig),
            backups: enabled,
          },
        }),
      );
      setConfirmOff(false);
      await load();
    } catch (toggleError) {
      setError(getApiErrorMessage(toggleError));
      // A turn-off can fail after the server already recorded it.
      await load();
    } finally {
      setToggling(false);
    }
  };

  if (backups === null) {
    return error ? (
      <p role="alert" className="px-1 text-xs text-status-danger">
        {error}
      </p>
    ) : (
      <p className="px-1 text-xs text-fg-tertiary">Loading backups…</p>
    );
  }

  const canRestore = backups.first_recoverability_point !== null;
  const enabled = backups.state !== 'off';

  const toggle = (
    <DetailSection
      title="Backups"
      description="Archives WAL continuously and makes a full copy daily, so any second of the last 7 days can be restored."
    >
      <div className="flex min-h-12 items-center justify-between gap-4 px-3 py-2">
        <label htmlFor={switchId} className="text-xs text-fg-primary">
          Back up this database
        </label>
        <Switch
          id={switchId}
          checked={enabled}
          disabled={toggling}
          onCheckedChange={(checked) =>
            checked ? void setEnabled(true) : setConfirmOff(true)
          }
        />
      </div>
      {error && !enabled ? (
        <p role="alert" className="px-3 pb-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}
    </DetailSection>
  );

  const offDialog = (
    <Dialog
      open={confirmOff}
      onOpenChange={(next) => !toggling && setConfirmOff(next)}
    >
      <DialogContent container={body} showCloseButton={!toggling}>
        <DialogHeader>
          <DialogTitle>Turn off backups</DialogTitle>
          <DialogDescription>
            WAL archiving stops and every backup of {workload.name} is deleted.
            It can no longer be restored to an earlier moment. Its data is not
            touched. Turning backups on again starts from a new full backup.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-xs text-status-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={toggling}
            onClick={() => setConfirmOff(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={toggling}
            onClick={() => void setEnabled(false)}
          >
            {toggling ? 'Deleting backups…' : 'Turn off and delete backups'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!enabled) {
    return (
      <DetailStack>
        {toggle}
        <p className="px-1 text-xs text-fg-tertiary">
          Backups are off. This database cannot be restored to an earlier
          moment.
        </p>
      </DetailStack>
    );
  }

  return (
    <DetailStack>
      {toggle}
      {offDialog}
      {backups.state === 'failing' ? (
        <DetailNotice
          title="Backups are failing"
          message={backups.message ?? 'The database cannot reach its backups'}
        />
      ) : null}

      <DetailSection
        title="Point-in-time recovery"
        description="WAL is archived as it is written. Restoring makes a new database; this one keeps running."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canRestore}
            onClick={() => setRestoreOpen(true)}
          >
            <History
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            Restore…
          </Button>
        }
      >
        <PropertyList>
          <PropertyRow label="Status">{STATE_LABEL[backups.state]}</PropertyRow>
          <PropertyRow label="Retention">
            {RETENTION_LABEL[backups.retention] ?? backups.retention}
          </PropertyRow>
          <PropertyRow label="Restorable from" className="tabular-nums">
            {backups.first_recoverability_point ? (
              <time dateTime={backups.first_recoverability_point}>
                {formatPreciseTime(backups.first_recoverability_point)}
              </time>
            ) : (
              <span className="text-fg-tertiary">After the first backup</span>
            )}
          </PropertyRow>
        </PropertyList>
      </DetailSection>

      <DetailSection
        title="Base backups"
        description="A full copy runs daily at 03:00 UTC."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || backups.state === 'provisioning'}
            onClick={() => void backUpNow()}
          >
            <DatabaseBackup
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            Back up now
          </Button>
        }
      >
        {error ? (
          <p role="alert" className="px-3 py-2 text-xs text-status-danger">
            {error}
          </p>
        ) : null}
        {backups.backups.length === 0 ? (
          <p className="px-3 py-3 text-xs text-fg-tertiary">
            {backups.state === 'provisioning'
              ? 'The first backup starts once backups are set up.'
              : 'No backups yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-edge-subtle">
            {backups.backups.map((backup) => (
              <BackupRow key={backup.name} backup={backup} />
            ))}
          </ul>
        )}
      </DetailSection>

      {canRestore ? (
        <RestoreDialog
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
          workload={workload}
          firstPoint={backups.first_recoverability_point!}
        />
      ) : null}
    </DetailStack>
  );
};

const BackupRow = ({ backup }: { backup: PostgresBackup }) => (
  <li className="flex min-h-10 items-center justify-between gap-4 px-3 py-2 text-xs">
    <div className="min-w-0">
      <p className="text-fg-primary tabular-nums">
        {backup.started_at ? formatAbsoluteTime(backup.started_at) : 'Not started'}
      </p>
      <p className="text-fg-tertiary">
        {backup.scheduled ? 'Daily' : 'Manual'}
        {backup.error ? ` · ${backup.error}` : ''}
      </p>
    </div>
    <span
      className={
        backup.phase === 'failed'
          ? 'shrink-0 font-medium text-status-danger'
          : 'shrink-0 text-fg-secondary'
      }
    >
      {PHASE_LABEL[backup.phase] ?? backup.phase}
    </span>
  </li>
);

const RestoreDialog = ({
  open,
  onOpenChange,
  workload,
  firstPoint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workload: Workload;
  firstPoint: string;
}) => {
  const { addWorkload } = useProject();
  const body = useBody();
  const nameId = useId();
  const timeId = useId();
  const [name, setName] = useState(`${workload.name} restore`);
  // Empty restores to the latest archived moment.
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const created = await postgresApi.restore(
        workload.project_id,
        workload.id,
        {
          name,
          target_time: time ? new Date(time).toISOString() : null,
        },
      );

      addWorkload(created);
      onOpenChange(false);
    } catch (restoreError) {
      setError(getApiErrorMessage(restoreError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent container={body} showCloseButton={!busy}>
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Restore to a point in time</DialogTitle>
            <DialogDescription>
              Creates a new database in this project with the data of{' '}
              {workload.name} as it was at the chosen moment. {workload.name}{' '}
              is not changed.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={nameId}>New database name</Label>
              <Input
                id={nameId}
                value={name}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={timeId}>Time (your local time)</Label>
              <Input
                id={timeId}
                type="datetime-local"
                step={1}
                min={toLocalInput(firstPoint)}
                max={toLocalInput(new Date().toISOString())}
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
              <p className="text-xs text-fg-tertiary">
                Leave empty for the latest moment. Earliest:{' '}
                {formatPreciseTime(firstPoint)}.
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-status-danger">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Restoring…' : 'Restore'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
