import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { V1Secret } from '@kubernetes/client-node';
import type {
  PostgresBackup,
  PostgresBackups,
  PostgresConfig,
} from '@acceleratio/shared';
import { eq } from 'drizzle-orm';
import { projectNamespace } from '@/common/naming';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { WORKLOAD_ID_LABEL } from '../docker/docker-workload.manifests';
import { workload, type WorkloadRow } from '../schemas/workload.schema';
import { workloadVersion } from '../schemas/workload-version.schema';
import {
  BUCKET_MESSAGE_ANNOTATION,
  BUCKET_PHASE_ANNOTATION,
  type BucketJobInput,
} from '../s3-bucket/s3-bucket.manifests';
import { generateBucketKeys } from '../s3-bucket/s3-bucket.service';
import {
  runBucketJob,
  rustfsS3Endpoint,
  rustfsTarget,
  startBucketJob,
} from '../s3-bucket/rustfs-jobs';
import { backupsEnabled } from './postgres.config';
import { findPostgresRow, readPostgresCluster } from './postgres.lookup';
import {
  BACKUP_ACCESS_KEY,
  BACKUP_RETENTION,
  BACKUP_SECRET_KEY,
  backupBucketName,
  backupSecretName,
  buildBackup,
  buildClusterBackup,
  buildScheduledBackup,
  CNPG_BACKUP_PLURAL,
  CNPG_CLUSTER_LABEL,
  CNPG_CLUSTER_PLURAL,
  CNPG_GROUP,
  CNPG_ROLE_LABEL,
  CNPG_SCHEDULED_BACKUP_PLURAL,
  CNPG_VERSION,
  type CnpgCluster,
  clusterStatus,
  POSTGRES_CONTAINER,
  scheduledBackupName,
} from './postgres.manifests';

const POLL_MS = 3000;
/** CNPG labels the backups a ScheduledBackup starts with its name. */
const SCHEDULED_BACKUP_LABEL = 'cnpg.io/scheduled-backup';
/** The bucket Job pulls the rc image on its first run. */
const JOB_WAIT_MS = 5 * 60 * 1000;
/** A new database runs initdb, or replays WAL when it is a restore. */
const READY_WAIT_MS = 60 * 60 * 1000;
export const BACKUPS_OFF_MESSAGE = 'Backups are turned off for this database';
export const RESTORE_RUNNING_MESSAGE =
  'A database is being restored from these backups. Wait until it runs, then try again.';
/** How long a restore waits for the current WAL to reach the archive. */
const FLUSH_WAIT_MS = 60 * 1000;
export const NO_BACKUP_MESSAGE =
  'No backup has finished yet, so there is nothing to restore from';

type Phase = 'provisioning' | 'ready' | 'failed';

export interface CnpgBackupObject {
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
  spec?: { cluster?: { name?: string } };
  status?: {
    phase?: string;
    startedAt?: string;
    stoppedAt?: string;
    error?: string;
  };
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms).unref());

const phaseOf = (secret: V1Secret | null): Phase | null => {
  const phase = secret?.metadata?.annotations?.[BUCKET_PHASE_ANNOTATION];

  return phase === 'ready' || phase === 'failed' || phase === 'provisioning'
    ? phase
    : null;
};

const hasCondition = (
  cluster: CnpgCluster | null,
  type: string,
  status: 'True' | 'False',
): boolean =>
  cluster?.status?.conditions?.some(
    (condition) => condition.type === type && condition.status === status,
  ) ?? false;

/** The backup state shown to the user, from the bucket Secret and the Cluster. */
export const backupState = (
  secret: V1Secret | null,
  cluster: CnpgCluster | null,
): Pick<PostgresBackups, 'state' | 'message'> => {
  const phase = phaseOf(secret);

  if (phase === 'failed') {
    return {
      state: 'failing',
      message:
        secret?.metadata?.annotations?.[BUCKET_MESSAGE_ANNOTATION] ??
        'The backup bucket could not be created',
    };
  }

  if (phase !== 'ready') {
    return { state: 'provisioning', message: null };
  }

  const archiving = cluster?.status?.conditions?.find(
    (condition) => condition.type === 'ContinuousArchiving',
  );

  if (archiving?.status === 'False') {
    return {
      state: 'failing',
      message: archiving.message || 'WAL archiving is failing',
    };
  }

  return { state: 'active', message: null };
};

/**
 * Start of the restore window. CNPG keeps `firstRecoverabilityPoint` from
 * before backups were turned off and on again, so it never counts earlier
 * than the oldest completed backup that exists now; none means no window.
 */
export const restoreWindowStart = (
  cluster: CnpgCluster | null,
  backups: CnpgBackupObject[],
): string | null => {
  const oldest = backups
    .filter(
      (item) => item.status?.phase === 'completed' && item.status.stoppedAt,
    )
    .map((item) => item.status!.stoppedAt!)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const reported = cluster?.status?.firstRecoverabilityPoint;

  if (!oldest) {
    return null;
  }

  return reported && Date.parse(reported) > Date.parse(oldest)
    ? reported
    : oldest;
};

/**
 * Clusters still bootstrapping from the given bucket: deleting it now would
 * break their recovery. A restored database keeps pointing at its source
 * forever, so only one whose bootstrap has not completed counts; a restore
 * that failed no longer reads it.
 */
export const restoringFrom = (
  clusters: CnpgCluster[],
  bucket: string,
): CnpgCluster[] =>
  clusters.filter((cluster) => {
    const sources = (cluster.spec.externalClusters ?? []) as Array<{
      barmanObjectStore?: { destinationPath?: string };
    }>;

    return (
      sources.some(
        (source) =>
          source.barmanObjectStore?.destinationPath === `s3://${bucket}/`,
      ) &&
      !hasCondition(cluster, 'Initialized', 'True') &&
      clusterStatus(cluster).status !== 'failed'
    );
  });

export const toBackup = (item: CnpgBackupObject): PostgresBackup => ({
  name: item.metadata.name,
  phase: item.status?.phase ?? 'pending',
  scheduled: Boolean(item.metadata.labels?.[SCHEDULED_BACKUP_LABEL]),
  started_at: item.status?.startedAt ?? null,
  stopped_at: item.status?.stoppedAt ?? null,
  error: item.status?.error ?? null,
});

/**
 * Continuous backups of PostgreSQL workloads: each database archives its WAL
 * and a daily base backup to its own RustFS bucket, reachable only with
 * its own keys. That makes any moment of the last 7 days restorable.
 */
@Injectable()
export class PostgresBackupService implements OnModuleInit {
  private readonly logger = new Logger(PostgresBackupService.name);
  /** Turn-offs running in this process, by database; one at a time each. */
  private readonly disabling = new Map<string, Promise<void>>();
  /**
   * Setups running in this process, by database. Turning backups off or
   * deleting the database drops the entry, so the setup stops at its next
   * step, and waits for it before cleaning up.
   */
  private readonly setups = new Map<
    string,
    { token: symbol; done: Promise<void> }
  >();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kubernetes: KubernetesService,
  ) {}

  /**
   * Every database converges once per start: older ones get backups, an
   * interrupted setup finishes, and a turn-off that failed half way is done.
   */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.db
        .select()
        .from(workload)
        .where(eq(workload.type, 'postgres'));

      for (const row of rows) {
        this.ensure(row);
      }
    } catch (error) {
      this.logger.warn(
        `Could not check PostgreSQL backups: ${describeError(error)}`,
      );
    }
  }

  get endpoint(): string {
    return rustfsS3Endpoint();
  }

  /**
   * Brings backups in line with the database's settings in the background:
   * when on, the bucket and its keys, the archive settings on the Cluster
   * and, once the database runs, the daily backup; when off, removes what a
   * failed turn-off left. Every step converges.
   */
  ensure(row: WorkloadRow): void {
    if (this.setups.has(row.id)) {
      return;
    }

    const token = Symbol(row.id);
    const done = this.setUp(row, token)
      .catch((error) =>
        this.logger.warn(
          `Backup setup of database ${row.id} failed: ${describeError(error)}`,
        ),
      )
      .finally(() => {
        if (this.setups.get(row.id)?.token === token) {
          this.setups.delete(row.id);
        }
      });

    this.setups.set(row.id, { token, done });
  }

  async list(projectId: string, id: string): Promise<PostgresBackups> {
    const row = await findPostgresRow(this.db, projectId, id);

    if (!(await this.enabled(row))) {
      return {
        state: 'off',
        message: null,
        retention: BACKUP_RETENTION,
        first_recoverability_point: null,
        backups: [],
      };
    }

    const [secret, cluster, backups] = await Promise.all([
      this.readSecret(row),
      this.readCluster(row),
      this.listBackups(row),
    ]);

    return {
      ...backupState(secret, cluster),
      retention: BACKUP_RETENTION,
      first_recoverability_point: restoreWindowStart(cluster, backups),
      backups: backups
        .map(toBackup)
        .sort((a, b) =>
          (b.started_at ?? '9999').localeCompare(a.started_at ?? '9999'),
        ),
    };
  }

  /** Starts a base backup now. */
  async backUp(projectId: string, id: string): Promise<PostgresBackups> {
    const row = await findPostgresRow(this.db, projectId, id);

    if (!(await this.enabled(row))) {
      throw new ConflictException(BACKUPS_OFF_MESSAGE);
    }

    const [secret, cluster] = await Promise.all([
      this.readSecret(row),
      this.readCluster(row),
    ]);

    if (backupState(secret, cluster).state === 'provisioning' || !cluster) {
      throw new ConflictException('Backups are still being set up');
    }

    if (clusterStatus(cluster).status !== 'running') {
      throw new ConflictException('Start the database to back it up');
    }

    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

    try {
      await this.kubernetes.customObjects.createNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(row.project_id),
        plural: CNPG_BACKUP_PLURAL,
        body: buildBackup(
          row,
          `${row.external_name}-${stamp}`,
          cluster.metadata.uid!,
        ),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 409) {
        throw new ConflictException('A backup was started a moment ago');
      }

      throw toNestException(error);
    }

    return this.list(projectId, id);
  }

  /** Earliest restorable time of a database; throws when there is none. */
  async firstRecoverabilityPoint(row: WorkloadRow): Promise<string> {
    if (!(await this.enabled(row))) {
      throw new ConflictException(BACKUPS_OFF_MESSAGE);
    }

    const [cluster, backups] = await Promise.all([
      this.readCluster(row),
      this.listBackups(row),
    ]);
    const point = restoreWindowStart(cluster, backups);

    if (!point) {
      throw new ConflictException(NO_BACKUP_MESSAGE);
    }

    return point;
  }

  /**
   * Switches to a new WAL segment and waits until the old one is archived,
   * so a restore can reach the last few minutes, which otherwise reach the
   * archive only once a segment fills or archive_timeout passes. Best effort:
   * a stopped database already archived everything when it stopped.
   */
  async flushWal(row: WorkloadRow): Promise<void> {
    try {
      // Nothing would arrive; the restore reaches what is archived already.
      if (
        hasCondition(
          await this.readCluster(row),
          'ContinuousArchiving',
          'False',
        )
      ) {
        return;
      }

      const namespace = projectNamespace(row.project_id);
      const { items } = await this.kubernetes.coreV1.listNamespacedPod({
        namespace,
        labelSelector: `${CNPG_CLUSTER_LABEL}=${row.external_name},${CNPG_ROLE_LABEL}=primary`,
      });
      const pod = items.find((item) => item.status?.phase === 'Running')
        ?.metadata?.name;

      if (!pod) {
        return;
      }

      const sql = (query: string) =>
        this.kubernetes
          .runInPod({
            namespace,
            pod,
            container: POSTGRES_CONTAINER,
            command: ['psql', '-X', '-A', '-t', '-d', 'postgres', '-c', query],
            timeoutMs: 15_000,
            maxBytes: 4096,
          })
          .then((output) => output.trim());
      const segment = await sql('select pg_walfile_name(pg_switch_wal())');

      // WAL file names of one timeline sort in order.
      for (
        const deadline = Date.now() + FLUSH_WAIT_MS;
        Date.now() < deadline;
      ) {
        if (
          (await sql('select last_archived_wal from pg_stat_archiver')) >=
          segment
        ) {
          return;
        }

        await sleep(1000);
      }
    } catch (error) {
      this.logger.warn(
        `Could not flush the WAL of ${row.external_name}: ${describeError(error)}`,
      );
    }
  }

  /** Refuses while a restore still reads this database's bucket. */
  async assertNotRestoringFrom(row: WorkloadRow): Promise<void> {
    const { items } =
      (await this.kubernetes.customObjects.listNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(row.project_id),
        plural: CNPG_CLUSTER_PLURAL,
      })) as { items: CnpgCluster[] };

    if (restoringFrom(items, backupBucketName(row.id)).length > 0) {
      throw new ConflictException(RESTORE_RUNNING_MESSAGE);
    }
  }

  /**
   * Deletes the daily backup, the keys and, through a Job, the bucket with
   * every backup in it. Backups are deleted with the database: they are not
   * a copy that outlives it. The caller checks for restores first.
   */
  async remove(row: WorkloadRow): Promise<void> {
    await this.cancelSetUp(row);
    await this.deleteSchedule(row);
    await this.deleteSecret(row);
    await startBucketJob(this.kubernetes, this.jobInput(row, 'delete')).catch(
      (error) =>
        this.logger.warn(
          `Could not delete the backup bucket of ${row.id}: ${describeError(error)}`,
        ),
    );
  }

  /**
   * Turns backups off: archiving stops and every backup is deleted with the
   * bucket. The keys go last, so a turn-off that fails half way is seen and
   * finished by the next setup; it waits for the bucket to be gone, so
   * turning backups on again starts from an empty one.
   */
  disable(row: WorkloadRow): Promise<void> {
    const running = this.disabling.get(row.id);

    if (running) {
      return running;
    }

    const done = this.turnOff(row).finally(() => this.disabling.delete(row.id));

    this.disabling.set(row.id, done);

    return done;
  }

  private async turnOff(row: WorkloadRow): Promise<void> {
    await this.assertNotRestoringFrom(row);
    await this.cancelSetUp(row);

    const cluster = await this.readCluster(row);
    const namespace = projectNamespace(row.project_id);

    if (cluster?.spec.backup !== undefined) {
      await this.kubernetes.customObjects.patchNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace,
        plural: CNPG_CLUSTER_PLURAL,
        name: row.external_name,
        body: [{ op: 'remove', path: '/spec/backup' }],
      });
    }

    for (const backup of await this.listBackups(row)) {
      await this.ignoreNotFound(() =>
        this.kubernetes.customObjects.deleteNamespacedCustomObject({
          group: CNPG_GROUP,
          version: CNPG_VERSION,
          namespace,
          plural: CNPG_BACKUP_PLURAL,
          name: backup.metadata.name,
        }),
      );
    }

    await this.deleteSchedule(row);

    const message = await runBucketJob(
      this.kubernetes,
      this.jobInput(row, 'delete'),
      null,
      JOB_WAIT_MS,
    );

    if (message !== null) {
      throw new ServiceUnavailableException(
        `Backups are off, but their bucket was not deleted yet: ${message}. It is retried when the database next starts.`,
      );
    }

    await this.deleteSecret(row);
  }

  /** Stops a running setup of this database and waits for it to end. */
  private async cancelSetUp(row: WorkloadRow): Promise<void> {
    const running = this.setups.get(row.id);

    this.setups.delete(row.id);
    await running?.done;
  }

  private async setUp(row: WorkloadRow, token: symbol): Promise<void> {
    const current = () => this.setups.get(row.id)?.token === token;

    if (!(await this.enabled(row))) {
      // Off: finish a turn-off that failed half way, if it left anything.
      if ((await this.readSecret(row)) !== null) {
        this.setups.delete(row.id);
        await this.disable(row);
      }

      return;
    }

    const ready = phaseOf(await this.readSecret(row)) === 'ready';

    // Already set up: the common case on every API start and database start.
    if (
      ready &&
      (await this.readCluster(row))?.spec.backup !== undefined &&
      (await this.scheduleExists(row))
    ) {
      return;
    }

    if (!ready && (!(await this.createBucket(row)) || !current())) {
      return;
    }

    await this.kubernetes.customObjects.patchNamespacedCustomObject({
      group: CNPG_GROUP,
      version: CNPG_VERSION,
      namespace: projectNamespace(row.project_id),
      plural: CNPG_CLUSTER_PLURAL,
      name: row.external_name,
      body: [
        {
          op: 'add',
          path: '/spec/backup',
          value: buildClusterBackup(row, this.endpoint),
        },
      ],
    });

    // A backup of a database that is not up yet fails, and the immediate
    // one would be lost until the next night.
    for (
      const deadline = Date.now() + READY_WAIT_MS;
      clusterStatus(await this.readCluster(row)).status !== 'running';
    ) {
      if (Date.now() > deadline || !current()) {
        return;
      }

      await sleep(POLL_MS);
    }

    if (!current()) {
      return;
    }

    try {
      await this.kubernetes.customObjects.createNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(row.project_id),
        plural: CNPG_SCHEDULED_BACKUP_PLURAL,
        body: buildScheduledBackup(row),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }
    }
  }

  /** Makes the bucket and an identity limited to it; false when that failed. */
  private async createBucket(row: WorkloadRow): Promise<boolean> {
    const keys = generateBucketKeys();

    await this.writeSecret(row, 'provisioning', null, {
      [BACKUP_ACCESS_KEY]: keys.accessKeyId,
      [BACKUP_SECRET_KEY]: keys.secretAccessKey,
    });

    const message = await runBucketJob(
      this.kubernetes,
      { ...this.jobInput(row, 'create'), tolerateExisting: true },
      keys,
      JOB_WAIT_MS,
    );

    await this.annotateSecret(
      row,
      message === null ? 'ready' : 'failed',
      message,
    );

    return message === null;
  }

  private jobInput(
    row: WorkloadRow,
    operation: 'create' | 'delete',
  ): BucketJobInput {
    return {
      workloadId: row.id,
      projectId: row.project_id,
      bucket: backupBucketName(row.id),
      operation,
      target: rustfsTarget(),
    };
  }

  private async scheduleExists(row: WorkloadRow): Promise<boolean> {
    try {
      await this.kubernetes.customObjects.getNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(row.project_id),
        plural: CNPG_SCHEDULED_BACKUP_PLURAL,
        name: scheduledBackupName(row.external_name),
      });
      return true;
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return false;
      }

      throw error;
    }
  }

  private async deleteSchedule(row: WorkloadRow): Promise<void> {
    await this.ignoreNotFound(() =>
      this.kubernetes.customObjects.deleteNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(row.project_id),
        plural: CNPG_SCHEDULED_BACKUP_PLURAL,
        name: scheduledBackupName(row.external_name),
      }),
    );
  }

  private async deleteSecret(row: WorkloadRow): Promise<void> {
    await this.ignoreNotFound(() =>
      this.kubernetes.coreV1.deleteNamespacedSecret({
        name: backupSecretName(row.external_name),
        namespace: projectNamespace(row.project_id),
      }),
    );
  }

  private async writeSecret(
    row: WorkloadRow,
    phase: Phase,
    message: string | null,
    stringData: Record<string, string>,
  ): Promise<void> {
    const name = backupSecretName(row.external_name);
    const namespace = projectNamespace(row.project_id);
    const body: V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      type: 'Opaque',
      metadata: {
        name,
        namespace,
        labels: { [WORKLOAD_ID_LABEL]: row.id },
        annotations: {
          [BUCKET_PHASE_ANNOTATION]: phase,
          ...(message ? { [BUCKET_MESSAGE_ANNOTATION]: message } : {}),
        },
      },
      stringData,
    };

    try {
      await this.kubernetes.coreV1.createNamespacedSecret({ namespace, body });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }

      await this.kubernetes.coreV1.replaceNamespacedSecret({
        name,
        namespace,
        body,
      });
    }
  }

  private async annotateSecret(
    row: WorkloadRow,
    phase: Phase,
    message: string | null,
  ): Promise<void> {
    await this.kubernetes.coreV1.patchNamespacedSecret({
      name: backupSecretName(row.external_name),
      namespace: projectNamespace(row.project_id),
      body: [
        {
          op: 'add',
          path: `/metadata/annotations/${BUCKET_PHASE_ANNOTATION.replace('/', '~1')}`,
          value: phase,
        },
        ...(message
          ? [
              {
                op: 'add',
                path: `/metadata/annotations/${BUCKET_MESSAGE_ANNOTATION.replace('/', '~1')}`,
                value: message,
              },
            ]
          : []),
      ],
    });
  }

  /** Read fresh: the caller's row may predate the version that changed it. */
  private async enabled(row: WorkloadRow): Promise<boolean> {
    const [current] = await this.db
      .select({ config: workloadVersion.config })
      .from(workload)
      .innerJoin(
        workloadVersion,
        eq(workloadVersion.id, workload.active_version_id),
      )
      .where(eq(workload.id, row.id))
      .limit(1);

    return backupsEnabled((current?.config as PostgresConfig) ?? null);
  }

  private async readSecret(row: WorkloadRow): Promise<V1Secret | null> {
    try {
      return await this.kubernetes.coreV1.readNamespacedSecret({
        name: backupSecretName(row.external_name),
        namespace: projectNamespace(row.project_id),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return null;
      }

      throw toNestException(error);
    }
  }

  private async readCluster(row: WorkloadRow): Promise<CnpgCluster | null> {
    try {
      return await readPostgresCluster(this.kubernetes, row);
    } catch (error) {
      throw toNestException(error);
    }
  }

  private async listBackups(row: WorkloadRow): Promise<CnpgBackupObject[]> {
    const { items } =
      (await this.kubernetes.customObjects.listNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(row.project_id),
        plural: CNPG_BACKUP_PLURAL,
      })) as { items: CnpgBackupObject[] };

    return items.filter(
      (item) => item.spec?.cluster?.name === row.external_name,
    );
  }

  private async ignoreNotFound(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }
    }
  }
}
