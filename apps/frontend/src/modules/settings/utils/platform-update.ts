import type {
  PlatformUpdate,
  PlatformUpdateStage,
  PlatformUpdateStatus,
} from '@acceleratio/shared';

export type UpdateStepState = 'done' | 'current' | 'failed' | 'pending';

export type UpdateStep = {
  stage: PlatformUpdateStage;
  label: string;
  state: UpdateStepState;
};

/** The stages every update goes through, in order. */
const STEPS: { stage: PlatformUpdateStage; label: string }[] = [
  { stage: 'launch', label: 'Start on the server' },
  { stage: 'download', label: 'Download and verify the release' },
  { stage: 'prepare', label: 'Check the installation' },
  { stage: 'backup', label: 'Back up the database and cluster state' },
  { stage: 'install', label: 'Install the new version' },
  { stage: 'verify', label: 'Check that everything is healthy' },
  { stage: 'cleanup', label: 'Remove old backups' },
];

const ROLLBACK_STEP = { stage: 'rollback', label: 'Roll back' } as const;

export const isUpdateActive = (update: PlatformUpdate | null): boolean =>
  update?.status === 'pending' || update?.status === 'running';

/**
 * The steps of an update with their state. A failed update marks the stage
 * it stopped at; a rollback adds its own step after it.
 */
export const updateSteps = (update: PlatformUpdate): UpdateStep[] => {
  const stage = update.stage ?? 'launch';
  const succeeded = update.status === 'succeeded';
  const finished = !isUpdateActive(update);
  const rolledBack = stage === 'rollback' || update.status === 'rolled_back';
  // Where the update stopped: the rollback started after the stage that
  // failed, which is not recorded, so a rollback marks the install stage.
  const reached = rolledBack ? 'install' : stage;
  const reachedIndex = STEPS.findIndex((step) => step.stage === reached);

  const steps: UpdateStep[] = STEPS.map((step, index) => {
    let state: UpdateStepState;

    if (succeeded || index < reachedIndex) {
      state = 'done';
    } else if (index === reachedIndex) {
      state = finished ? 'failed' : 'current';
    } else {
      state = 'pending';
    }

    return { ...step, state };
  });

  if (rolledBack) {
    steps.push({
      ...ROLLBACK_STEP,
      state: !finished
        ? 'current'
        : update.status === 'rolled_back'
          ? 'done'
          : 'failed',
    });
  }

  return steps;
};

export const UPDATE_STATUS_LABELS: Record<PlatformUpdateStatus, string> = {
  pending: 'Starting',
  running: 'Updating',
  succeeded: 'Updated',
  failed: 'Failed',
  rolled_back: 'Rolled back',
};

/** `0.1.6` → `v0.1.6`; versions are shown with the v the release tags use. */
export const formatVersion = (version: string | null): string =>
  version ? `v${version}` : 'Unknown';

export type PlatformStatusTone = 'neutral' | 'info' | 'success' | 'danger';

export type PlatformStatus = {
  tone: PlatformStatusTone;
  /** Short label, such as "Update available". */
  label: string;
  /** The line under it; null when the label says it all. */
  detail: string | null;
};

/**
 * The one-line verdict at the top of the platform section: an update in
 * progress wins, then a failed check, then whether a newer release exists.
 */
export const platformStatus = (info: {
  latest_version: string | null;
  update_available: boolean;
  checked_at: string | null;
  check_error: string | null;
  active_update: PlatformUpdate | null;
}): PlatformStatus => {
  if (isUpdateActive(info.active_update)) {
    return {
      tone: 'info',
      label: `Updating to ${formatVersion(info.active_update!.to_version)}`,
      detail: null,
    };
  }

  if (info.check_error) {
    return {
      tone: 'danger',
      label: 'Could not check for updates',
      detail: info.check_error,
    };
  }

  if (!info.checked_at) {
    return { tone: 'neutral', label: 'Not checked yet', detail: null };
  }

  if (info.update_available && info.latest_version) {
    return {
      tone: 'info',
      label: `${formatVersion(info.latest_version)} is available`,
      detail: null,
    };
  }

  return { tone: 'success', label: 'Up to date', detail: null };
};

/** "4m 05s", "1h 02m": how long an update has run or ran. */
export const formatElapsed = (from: string, to: string | number): string => {
  const end = typeof to === 'number' ? to : new Date(to).getTime();
  const seconds = Math.max(
    0,
    Math.floor((end - new Date(from).getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m`;
  }

  return minutes > 0 ? `${minutes}m ${pad(rest)}s` : `${rest}s`;
};

/** Done steps out of all steps, 0 to 1, for the progress bar. */
export const updateProgress = (steps: UpdateStep[]): number =>
  steps.length === 0
    ? 0
    : steps.filter((step) => step.state === 'done').length / steps.length;
