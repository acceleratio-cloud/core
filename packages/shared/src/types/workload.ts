export type WorkloadType =
  | 'docker'
  | 's3_bucket'
  | 'github'
  | 'postgres'
  | 'static';

/**
 * Types that run as a Deployment with Docker service settings: instances,
 * domains and logs. A `github` service is a Docker service whose image is
 * built from its repository; a `static` site one that serves uploaded files.
 */
export const isContainerWorkload = (type: WorkloadType): boolean =>
  type === 'docker' || type === 'github' || type === 'static';

export type WorkloadStatus =
  'draft' | 'deploying' | 'running' | 'stopped' | 'failed';

export interface WorkloadPosition {
  x: number;
  y: number;
}

/** One environment variable of a Docker service. */
export interface EnvVar {
  key: string;
  value: string;
}

export interface DockerWorkloadConfig {
  docker_image: string;
  /** CPU limit in vCPU (0.5 = 500m). Absent means 1 vCPU, null no limit. */
  cpu_max?: number | null;
  /** Memory limit in MiB. Absent means 1024 MiB, null no limit. */
  ram_max?: number | null;
  /** Pods the service runs, 1 to 10. Absent means 1. */
  replicas?: number;
  /**
   * Node labels the pods must run on (Kubernetes `nodeSelector`). Absent or
   * empty lets the scheduler use any schedulable node.
   */
  node_selector?: Record<string, string>;
  /** Replaces the image ENTRYPOINT. Absent keeps the image's own. */
  entrypoint?: string[];
  /** Replaces the image CMD. Absent keeps the image's own. */
  command?: string[];
  /**
   * Environment variables, in the order the user wrote them. Applied through a
   * Kubernetes Secret on deploy.
   *
   * Write-only: responses never carry values (see `env_keys` and
   * `WorkloadEnv`). In an update, an absent `env` keeps the current variables
   * and `[]` removes them all.
   */
  env?: EnvVar[];
  /**
   * Response-only: the variable names, in order, so lists and version history
   * can describe a config without exposing values. Ignored in requests.
   */
  env_keys?: string[];
  /**
   * Persistent volumes mounted into every replica, in the order the user
   * added them. In an update, an absent `volumes` keeps the current volumes
   * and `[]` removes them all; on create, absent means none.
   *
   * Claims are created on deploy. A claim the applied config no longer lists
   * is deleted once no pod of an earlier version mounts it. A rollback keeps
   * the volumes the service has, whatever the restored version had.
   */
  volumes?: DockerWorkloadVolume[];
}

/**
 * A persistent volume of a Docker service (a Kubernetes PersistentVolumeClaim).
 * Only the mount path can change after creation.
 */
export interface DockerWorkloadVolume {
  /** Stable id. Absent on a new volume in a request; the API assigns it. */
  id?: string;
  /** Absolute path inside the container, such as `/data`. */
  mount_path: string;
  /** Maximum size in GiB, 1 to 100. Fixed after creation. */
  size_gb: number;
  /** Storage profile; null uses the platform profile. Fixed after creation. */
  storage_class_id: string | null;
}

/** The variables a Docker service is heading to: the draft's, else the active version's. */
export interface WorkloadEnv {
  env: EnvVar[];
}

/**
 * An S3 bucket in SeaweedFS. The bucket is named after the workload and its
 * storage profile is fixed when it is created.
 */
export interface S3BucketConfig {
  /** Storage profile whose replication, disk type and TTL the bucket uses. */
  storage_class_id: string;
}

/**
 * A service built from a repository branch read through a GitHub App of the
 * integration. It runs like a Docker service and has the same settings; a
 * deploy builds the branch's `Dockerfile` and fills `docker_image` and
 * `commit_sha`. The App and repository are fixed after creation; the branch can be changed and the next deploy builds its head.
 */
export interface GithubWorkloadConfig extends Omit<
  DockerWorkloadConfig,
  'docker_image'
> {
  /** `GithubApp.id` the repository is read through. */
  github_app_id: string;
  /** `owner/name`. */
  repository: string;
  branch: string;
  /** Image of the last build, by digest. Set by the API; absent until then. */
  docker_image?: string;
  /** Commit `docker_image` was built from. Set by the API. */
  commit_sha?: string;
}

/**
 * A static site: uploaded files served over HTTP on port 80. Each upload is a
 * release; deploying one rolls the pods onto it without downtime and a
 * rollback serves an earlier release's files again. `/` serves
 * `index.html`, a missing path `404.html` when the release has one; hidden
 * files are never served. The file server belongs to the platform, so its
 * image is not part of the config.
 */
export interface StaticWorkloadConfig extends Pick<
  DockerWorkloadConfig,
  'cpu_max' | 'ram_max' | 'replicas'
> {
  /**
   * Release the site serves; absent until the first upload is published.
   * Changed only by `POST …/releases/:releaseId/publish`, never by an update.
   */
  release_id?: string;
}

/** `POST …/releases`: an empty release to upload the site's files into. */
export interface StaticRelease {
  id: string;
}

export type WorkloadBuildStatus =
  | 'building'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** One image build of a GitHub service, started by a deploy or a push. */
export interface WorkloadBuild {
  id: string;
  workload_id: string;
  commit_sha: string;
  /** First line of the commit message. */
  commit_message: string | null;
  status: WorkloadBuildStatus;
  /** Why a build failed, for people. */
  status_message: string | null;
  /** Who started it: the deploying user, or the GitHub account that pushed. */
  author: WorkloadVersionAuthor | null;
  /** The pushed image, by digest, once the build succeeded. */
  image: string | null;
  created_at: string;
  finished_at: string | null;
}

/** `GET …/builds/:buildId/log`: the builder's output so far. */
export interface WorkloadBuildLog {
  log: string;
}

/** Major PostgreSQL versions a `postgres` workload can be created with. */
export const POSTGRES_VERSIONS = ['17', '16'] as const;
export type PostgresVersion = (typeof POSTGRES_VERSIONS)[number];

/**
 * A single-instance PostgreSQL database run by CloudNativePG. The version,
 * disk size and storage profile are fixed after creation; CPU and memory can
 * change.
 */
export interface PostgresConfig {
  postgres_version: PostgresVersion;
  /** Disk size in GiB, 1 to 100. */
  size_gb: number;
  /** Storage profile; null uses the platform profile. */
  storage_class_id: string | null;
  /** CPU limit in vCPU. Absent means 1 vCPU, null no limit. */
  cpu_max?: number | null;
  /** Memory limit in MiB. Absent means 1024 MiB, null no limit. */
  ram_max?: number | null;
  /** Continuous backups and point-in-time recovery. Absent means on. */
  backups?: boolean;
}

export type WorkloadConfig =
  | DockerWorkloadConfig
  | S3BucketConfig
  | GithubWorkloadConfig
  | PostgresConfig
  | StaticWorkloadConfig;

/**
 * How project services reach a `postgres` workload. The password stays in
 * the Kubernetes Secret `secret_name` (keys `username` and `password`) and is
 * never returned by the API.
 */
export interface PostgresConnection {
  /** Read-write service inside the project namespace. */
  host: string;
  port: number;
  database: string;
  username: string;
  secret_name: string;
}

/**
 * `GET`/`PUT …/postgres/exposure`: the database's port opened outside the
 * cluster. Closed by default. Outside the pod network the server accepts
 * TLS connections only (`sslmode=require`).
 */
export interface PostgresExposure {
  enabled: boolean;
  /** Source networks allowed to connect; `0.0.0.0/0` is everyone. */
  allowed_cidrs: string[];
  /** Node port, 30000 to 32767; null while closed. */
  node_port: number | null;
  /**
   * Address of the node that runs the database, which is the only node that
   * answers on the port. Null while closed or while no instance runs.
   */
  host: string | null;
}

export interface UpdatePostgresExposurePayload {
  enabled: boolean;
  /** Required and non-empty when `enabled`; at most 20 networks. */
  allowed_cidrs?: string[];
  /** A fixed node port; absent or null lets Kubernetes pick one. */
  node_port?: number | null;
}

/**
 * `POST …/postgres/credentials/rotate`: the new password, returned once and
 * never again. The database applies it within seconds; the old one stops
 * working then.
 */
export interface PostgresCredentials {
  username: string;
  password: string;
  secret_name: string;
}

/**
 * Where a database's backups stand: `off` when they are turned off,
 * `provisioning` while its bucket is being made, `active` while WAL reaches
 * the bucket, `failing` when archiving or the bucket setup fails (see
 * `message`).
 */
export type PostgresBackupState = 'off' | 'provisioning' | 'active' | 'failing';

/** One base backup, as CloudNativePG reports it. */
export interface PostgresBackup {
  name: string;
  /** CloudNativePG's phase, such as `running`, `completed` or `failed`. */
  phase: string;
  /** True for the daily backup, false for one started from the console. */
  scheduled: boolean;
  started_at: string | null;
  stopped_at: string | null;
  error: string | null;
}

/** `GET …/postgres/backups`: the backup state and the restore window. */
export interface PostgresBackups {
  state: PostgresBackupState;
  message: string | null;
  /** Retention of base backups and WAL, such as `7d`. */
  retention: string;
  /** Earliest time a restore can reach; null before the first backup finished. */
  first_recoverability_point: string | null;
  /** Newest first. */
  backups: PostgresBackup[];
}

/**
 * `POST …/postgres/restore`: a new database in the same project with the
 * data as it was at `target_time` (ISO 8601), or as late as the archive
 * reaches when null.
 */
export interface RestorePostgresPayload {
  name: string;
  target_time: string | null;
}

/**
 * `POST …/postgres/import`: a dump loaded into the `app` database in one
 * transaction. `custom` is a pg_dump `-Fc` archive, `sql` a plain script.
 */
export interface PostgresImportResult {
  format: 'custom' | 'sql';
}

export interface PostgresConnectionStats {
  active: number;
  idle: number;
  max: number;
}

export interface PostgresLongQuery {
  pid: number;
  state: string | null;
  /** Seconds since the query started. */
  duration_seconds: number;
  /** First 500 characters of the statement. */
  query: string;
}

/** `GET …/postgres/overview`: state and load of the running database. */
export interface PostgresOverview {
  version: string;
  started_at: string;
  /** Size of the application database, in bytes. */
  database_size_bytes: number;
  connections: PostgresConnectionStats;
  /** Commits plus rollbacks per second since statistics were reset. */
  transactions_per_second: number;
  /** Share of block reads served from shared buffers, 0 to 1; null before any read. */
  cache_hit_ratio: number | null;
  /** Locks other sessions are waiting for. */
  waiting_locks: number;
  /** Statements running longer than 30 seconds, longest first. */
  long_queries: PostgresLongQuery[];
}

export interface PostgresIndex {
  name: string;
  definition: string;
  size_bytes: number;
}

/** One table of the application database. */
export interface PostgresTable {
  schema: string;
  name: string;
  /** Table plus its indexes and TOAST, in bytes. */
  size_bytes: number;
  /** The planner's estimate; -1 when the table was never analyzed. */
  row_estimate: number;
  indexes: PostgresIndex[];
}

/** `GET …/postgres/tables/:schema/:table/rows`: one read-only page. */
export interface PostgresRows {
  columns: string[];
  /** Values as PostgreSQL prints them; null for SQL NULL. */
  rows: (string | null)[][];
  page: number;
  page_size: number;
  /** True when more rows follow this page. */
  has_more: boolean;
}

/** How a project workload reaches an S3 bucket. The secret key is separate. */
export interface S3BucketAccess {
  bucket: string;
  /** S3 endpoint inside the cluster. */
  endpoint: string;
  region: string;
  access_key_id: string;
  /** Kubernetes Secret in the project namespace that holds both keys. */
  secret_name: string;
}

/** Returned only on request, so the secret key is never part of a list. */
export interface S3BucketCredentials extends S3BucketAccess {
  secret_access_key: string;
}

/** One level of a bucket, as the console's explorer shows it. */
export interface S3BucketEntry {
  /** Last path segment: the file or folder name. */
  name: string;
  /** Object key from the bucket root; folders end with `/`. */
  path: string;
  kind: 'folder' | 'file';
  /** Bytes; null for folders. */
  size: number | null;
  content_type: string | null;
  modified_at: string | null;
}

export interface S3BucketListing {
  /** The folder listed, `""` for the bucket root, otherwise ending with `/`. */
  prefix: string;
  /** Folders first, then files, each by name. */
  entries: S3BucketEntry[];
  /** True when the folder holds more entries than one listing returns. */
  truncated: boolean;
}

export interface CreateS3FolderPayload {
  /** Folder key from the bucket root, with or without a trailing `/`. */
  path: string;
}

/** Immutable snapshot of a config that was applied to the cluster. */
export interface WorkloadVersion {
  id: string;
  workload_id: string;
  /** 1, 2, 3, … within one workload. */
  number: number;
  config: WorkloadConfig;
  /** The version a rollback copied its config from. */
  source_version_id: string | null;
  /**
   * Who applied it, as they were named at the time. Null for versions from
   * before authors were recorded and for ones the platform wrote itself.
   */
  created_by: WorkloadVersionAuthor | null;
  /** When the version was applied to the cluster. */
  created_at: string;
}

export interface WorkloadVersionAuthor {
  /**
   * Null once the account is deleted (name and email stay), and for a GitHub
   * account that pushed, which has no account here.
   */
  id: string | null;
  name: string;
  email: string;
  /** The GitHub account behind a push deploy: `github.com/<login>`. */
  github_login: string | null;
}

/**
 * One side of a comparison: a stored version, the pending draft, or nothing
 * (a service that was never deployed has no current version).
 */
export type WorkloadDiffSide =
  | { kind: 'version'; version_id: string; number: number }
  | { kind: 'draft' }
  | { kind: 'none' };

export type WorkloadChangeKind = 'added' | 'removed' | 'changed';

/**
 * What applying a change does to the running service:
 * - `restart`: the pods are replaced by a rolling update;
 * - `data_loss`: a volume claim and its data are deleted.
 */
export type WorkloadChangeImpact = 'restart' | 'data_loss';

/** One field that differs between the two sides. */
export interface WorkloadConfigChange {
  /** Stable machine key, such as `env.DATABASE_URL` or `volumes.<id>.mount_path`. */
  path: string;
  /** What the field is, for people: `CPU limit`, `DATABASE_URL`. */
  label: string;
  kind: WorkloadChangeKind;
  /** Display value on the base side; null when absent or secret. */
  before: string | null;
  /** Display value on the target side; null when absent or secret. */
  after: string | null;
  /** The values are never sent; only the fact of the change is. */
  secret: boolean;
  impact: WorkloadChangeImpact | null;
}

/** Changes of one part of the config, in the order the type defines. */
export interface WorkloadDiffSection {
  /** `image`, `command`, `resources`, `placement`, `environment`, `volumes`, `storage`. */
  key: string;
  label: string;
  changes: WorkloadConfigChange[];
}

/**
 * What changes when the target replaces the base. Computed on the server so
 * every workload type answers in the same shape; sections without changes
 * are left out.
 */
export interface WorkloadVersionDiff {
  workload_id: string;
  type: WorkloadType;
  base: WorkloadDiffSide;
  target: WorkloadDiffSide;
  /** True when nothing differs. */
  identical: boolean;
  sections: WorkloadDiffSection[];
  /** Applying it replaces the running pods. */
  restarts: boolean;
  /** Applying it deletes stored data. */
  data_loss: boolean;
  /** Things the type wants said about this comparison, one sentence each. */
  notes: string[];
}

/**
 * `GET …/versions/diff`. `base` defaults to `active`, `target` to `draft`;
 * either may also be a version id.
 */
export interface WorkloadVersionDiffQuery {
  base?: 'active' | string;
  target?: 'active' | 'draft' | string;
}

export interface Workload {
  id: string;
  project_id: string;
  name: string;
  type: WorkloadType;
  /** Version applied to the cluster; null until the first deploy. */
  active_version: WorkloadVersion | null;
  /** Changes that the next deploy applies; null when there are none. */
  draft_config: WorkloadConfig | null;
  position: WorkloadPosition;
  status: WorkloadStatus;
  status_message: string | null;
  /** When the stored status was last derived from the cluster. */
  status_observed_at: string | null;
  /** Deployment name in the cluster. Generated once, never changes. */
  external_name: string;
  /** Kubernetes namespace that holds the workload: `project-<project_id>`. */
  namespace: string;
  /**
   * Private DNS label of a Docker service, unique in its project. Defaults to
   * the slug of the name, does not follow a rename. Null for other types.
   */
  internal_hostname?: string | null;
  /**
   * `<internal_hostname>.internal`: reaches the service on any port from every
   * service of the same project, never from another project. Always on.
   */
  internal_domain?: string | null;
  last_deployed_at: string | null;
  /**
   * Icon shown in the console: a `WORKLOAD_ICON_IDS` id or an `https://` URL
   * of an image. Null shows the default icon of the type. Not deployed.
   */
  icon: string | null;
  /**
   * GitHub services only: a push to the followed branch deploys a service
   * that was deployed before. Applies at once, outside versions.
   */
  auto_deploy?: boolean;
  /** Set for `s3_bucket` workloads once their keys exist. */
  s3?: S3BucketAccess | null;
  /** Set for `postgres` workloads. */
  postgres?: PostgresConnection | null;
  created_at: string;
  updated_at: string;
}

export interface WorkloadStatusEvent {
  type: 'status';
  workload_id: string;
  project_id: string;
  status: WorkloadStatus;
  status_message: string | null;
  status_observed_at: string | null;
  updated_at: string;
}

export interface WorkloadPositionEvent {
  type: 'position';
  workload_id: string;
  project_id: string;
  position: WorkloadPosition;
  updated_at: string;
}

export interface WorkloadIconEvent {
  type: 'icon';
  workload_id: string;
  project_id: string;
  icon: string | null;
  updated_at: string;
}

export type WorkloadEvent =
  | WorkloadStatusEvent
  | WorkloadPositionEvent
  | WorkloadIconEvent;

/** Lifecycle of one running copy (a Kubernetes Pod) of a Docker service. */
export type WorkloadInstanceStatus =
  | 'running'
  | 'starting'
  | 'pending'
  | 'terminating'
  | 'failed'
  | 'completed'
  | 'unknown';

/** One running copy of a Docker service with its live resource usage. */
export interface WorkloadInstance {
  name: string;
  status: WorkloadInstanceStatus;
  /** Machine reason behind a non-running status, e.g. `CrashLoopBackOff`. */
  status_reason: string | null;
  status_message: string | null;
  ready: boolean;
  restarts: number;
  node: string | null;
  ip: string | null;
  /** The workload version the instance was started from. */
  version_id: string | null;
  created_at: string | null;
  started_at: string | null;
  /** Null when usage is unknown (no samples yet or metrics unavailable). */
  cpu_cores: number | null;
  /** Null when the instance runs without a CPU limit. */
  cpu_limit_cores: number | null;
  memory_bytes: number | null;
  memory_limit_bytes: number | null;
}

export interface WorkloadInstancesSnapshot {
  workload_id: string;
  /** Newest first; terminating instances last. */
  instances: WorkloadInstance[];
  /** False when VictoriaMetrics could not be reached for usage. */
  metrics_available: boolean;
  observed_at: string;
}

export interface CreateWorkloadPayload {
  name: string;
  type: WorkloadType;
  /** Required for `docker`; an `s3_bucket` without one uses the platform profile. */
  config?: WorkloadConfig;
}

export interface UpdateInternalHostnamePayload {
  /** A DNS label (`postgres`); a trailing `.internal` is accepted. */
  internal_hostname: string;
}

/** Built-in workload icons; the console maps each id to a logo. */
export const WORKLOAD_ICON_IDS = [
  'python',
  'javascript',
  'typescript',
  'nodejs',
  'deno',
  'bun',
  'react',
  'nextjs',
  'vue',
  'nuxt',
  'angular',
  'svelte',
  'astro',
  'go',
  'rust',
  'java',
  'spring',
  'kotlin',
  'csharp',
  'dotnet',
  'php',
  'laravel',
  'ruby',
  'django',
  'flask',
  'fastapi',
  'nestjs',
  'elixir',
  'swift',
  'docker',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'nginx',
] as const;

export type WorkloadIconId = (typeof WORKLOAD_ICON_IDS)[number];

/** Longest accepted icon URL. */
export const WORKLOAD_ICON_URL_MAX_LENGTH = 2048;

export interface UpdateWorkloadIconPayload {
  /** A `WORKLOAD_ICON_IDS` id, an `https://` URL, or null for the default. */
  icon: string | null;
}

export interface UpdateWorkloadPayload {
  name?: string;
  /** GitHub services only; see `Workload.auto_deploy`. */
  auto_deploy?: boolean;
  config?: WorkloadConfig;
  position?: WorkloadPosition;
}
