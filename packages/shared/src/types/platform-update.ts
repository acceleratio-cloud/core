/** A piece of the installation and the version it runs. */
export interface PlatformComponent {
  /** Stable key, such as `api`, `console`, `k3s` or a Helm release name. */
  id: string;
  name: string;
  /** Version, chart version or image tag; null when it cannot be read. */
  version: string | null;
  /** Extra detail, such as the image or the chart name. */
  detail: string | null;
}

/** A published stable release that is newer than the running one. */
export interface PlatformRelease {
  /** Semantic version without the leading v, such as `0.2.0`. */
  version: string;
  name: string;
  /** Release notes as Markdown, as written on GitHub. */
  notes: string;
  /** Page of the release. */
  url: string;
  /** ISO 8601 timestamp. */
  published_at: string | null;
}

/**
 * `pending`: saved, the launcher Job is being created.
 * `running`: the update runs on the server.
 * `succeeded`: the new version is installed and healthy.
 * `failed`: the update stopped; see `message` for whether anything changed.
 * `rolled_back`: the update failed and the previous version was restored.
 */
export type PlatformUpdateStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'rolled_back';

/**
 * Where an update stands, in order. `rollback` only appears after a failure.
 */
export type PlatformUpdateStage =
  | 'launch'
  | 'download'
  | 'prepare'
  | 'backup'
  | 'install'
  | 'verify'
  | 'cleanup'
  | 'rollback'
  | 'done';

export interface PlatformUpdate {
  id: string;
  from_version: string;
  to_version: string;
  status: PlatformUpdateStatus;
  stage: PlatformUpdateStage | null;
  /** Outcome or the reason of a failure. */
  message: string | null;
  /** Account email (or id) that started the update. */
  actor: string | null;
  /** ISO 8601 timestamps. */
  started_at: string;
  finished_at: string | null;
  /** When the server last reported progress. */
  reported_at: string | null;
}

/** An update with the tail of its log. */
export interface PlatformUpdateDetails extends PlatformUpdate {
  log: string;
}

export interface PlatformVersionInfo {
  /** Version of the running API; null for a development build. */
  current_version: string | null;
  components: PlatformComponent[];
  /** Highest stable release; null before the first successful check. */
  latest_version: string | null;
  update_available: boolean;
  /** Stable releases newer than the current version, newest first. */
  releases: PlatformRelease[];
  /** ISO 8601 timestamp of the last check, successful or not. */
  checked_at: string | null;
  /** Why the last check failed (for example no internet access). */
  check_error: string | null;
  /** Where releases come from, such as `github.com/acceleratio-cloud/core`. */
  release_source: string;
  /** Null when an update can be started; otherwise why not. */
  update_blocked_reason: string | null;
  /** The update in progress, if any. */
  active_update: PlatformUpdate | null;
  /** The most recent finished update. */
  last_update: PlatformUpdate | null;
}

export interface StartPlatformUpdatePayload {
  /** Target version without the leading v; must be a listed release. */
  version: string;
}
