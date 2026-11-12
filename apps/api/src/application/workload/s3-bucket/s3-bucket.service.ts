import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { V1Job, V1Secret } from '@kubernetes/client-node';
import type {
  CreateWorkloadPayload,
  S3BucketAccess,
  S3BucketConfig,
  S3BucketCredentials,
  UpdateWorkloadPayload,
  Workload,
  WorkloadVersion as WorkloadVersionContract,
  WorkloadVersionDiff,
} from '@acceleratio/shared';
import { and, asc, eq } from 'drizzle-orm';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import { WorkloadEventsService } from '@/application/workload/observer/workload-events.service';
import {
  workload,
  type WorkloadRow,
} from '@/application/workload/schemas/workload.schema';
import type { WorkloadVersionRow } from '@/application/workload/schemas/workload-version.schema';
import {
  nextWorkloadPosition,
  normalizeWorkloadPosition,
} from '@/application/workload/workload-position';
import type { WorkloadTypeService } from '@/application/workload/workload-type-service';
import {
  toWorkloadVersion,
  WorkloadVersionService,
} from '@/application/workload/workload-version.service';
import { projectNamespace } from '@/common/naming';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { jobOutcome } from '@/vendor/kubernetes/job-outcome';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { S3_REGION } from '@/vendor/s3/rustfs';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
} from '../docker/docker-workload.manifests';
import { buildDiff } from '@/application/workload/workload-version.diff';
import { normalizeBucketConfig, normalizeBucketName } from './s3-bucket.config';
import {
  ACTIVE_DEADLINE_SECONDS,
  BUCKET_ERROR_PREFIX,
  BUCKET_WORKLOAD_LABEL,
  bucketJobName,
  buildJobSecret,
  BUCKET_MESSAGE_ANNOTATION,
  BUCKET_PHASE_ANNOTATION,
  buildProjectSecret,
  type BucketPhase,
  projectSecretName,
  type BucketJobInput,
  type BucketKeys,
  type BucketOperation,
  type RustfsTarget,
} from './s3-bucket.manifests';
import {
  readBucketJob,
  readBucketJobLog,
  rustfsS3Endpoint,
  rustfsTarget,
  startBucketJob,
} from './rustfs-jobs';

export const UNSUPPORTED_ACTION_MESSAGE = 'Not supported for S3 buckets';
export const LOCKED_BUCKET_MESSAGE = 'Bucket name cannot change after creation';
export const BUCKET_TAKEN_MESSAGE = 'Bucket name is already taken';

const UNIQUE_VIOLATION = '23505';
const POLL_INTERVAL_MS = 2000;
/** The Job deadline plus time for the image pull. */
const GIVE_UP_AFTER_MS = (ACTIVE_DEADLINE_SECONDS + 120) * 1000;
const DELETE_WAIT_MS = 90_000;
const ACCESS_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isUniqueViolation = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (
    typeof current === 'object' &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };

    if (candidate.code === UNIQUE_VIOLATION) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
};

/** AWS-shaped keys: a 20-character access key id and a 40-character secret. */
export const generateBucketKeys = (): BucketKeys => {
  const bytes = randomBytes(18);
  const id = Array.from(
    bytes,
    (byte) => ACCESS_KEY_ALPHABET[byte % ACCESS_KEY_ALPHABET.length],
  ).join('');

  return {
    accessKeyId: `AC${id}`,
    secretAccessKey: randomBytes(30).toString('base64url'),
  };
};

/** The message a failed Job left, or a generic one when it left none. */
export const bucketErrorFromLog = (log: string | null): string => {
  const line = (log ?? '')
    .split('\n')
    .reverse()
    .find((entry) => entry.startsWith(BUCKET_ERROR_PREFIX));

  return (
    line?.slice(BUCKET_ERROR_PREFIX.length).trim() ||
    'Object storage did not finish the bucket operation'
  );
};

const phaseOf = (secret: V1Secret): BucketPhase => {
  const phase = secret.metadata?.annotations?.[BUCKET_PHASE_ANNOTATION];

  // A Secret from before the annotation existed belongs to a ready bucket.
  return phase === 'provisioning' || phase === 'failed' ? phase : 'ready';
};

/** A bucket's status, read from its Secret: the cluster is the only record. */
const bucketStatus = (
  secret: V1Secret | null,
): Pick<Workload, 'status' | 'status_message' | 'status_observed_at'> => {
  const observed = new Date().toISOString();

  if (secret === null) {
    return {
      status: 'failed',
      status_message: 'The bucket keys are missing from the cluster',
      status_observed_at: observed,
    };
  }

  const phase = phaseOf(secret);
  const message =
    secret.metadata?.annotations?.[BUCKET_MESSAGE_ANNOTATION] ?? null;

  return {
    status:
      phase === 'provisioning'
        ? 'deploying'
        : phase === 'failed'
          ? 'failed'
          : 'running',
    status_message: phase === 'failed' ? message : null,
    status_observed_at: observed,
  };
};

const decode = (secret: V1Secret, key: string): string | undefined => {
  const value = secret.data?.[key];

  return value === undefined
    ? undefined
    : Buffer.from(value, 'base64').toString('utf8');
};

/**
 * S3 buckets in RustFS. A bucket has no Deployment, so the workload observer
 * never touches it: this service owns the status. Creating a bucket runs an
 * `rc` Job that makes the bucket and registers a key limited to it. The keys
 * live in a Secret in the project namespace, never in the database.
 */
@Injectable()
export class S3BucketWorkloadService
  implements WorkloadTypeService, OnModuleInit, OnModuleDestroy
{
  readonly type = 's3_bucket' as const;

  private readonly logger = new Logger(S3BucketWorkloadService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Buckets whose keys are being replaced; one rotation at a time each. */
  private readonly rotating = new Set<string>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectService: ProjectService,
    private readonly isolation: ProjectIsolationService,
    private readonly kubernetes: KubernetesService,
    private readonly events: WorkloadEventsService,
    private readonly versions: WorkloadVersionService,
  ) {}

  /** Creates that were running when the API stopped are followed again. */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.db
        .select({ id: workload.id, project_id: workload.project_id })
        .from(workload)
        .where(eq(workload.type, this.type));

      for (const projectId of new Set(rows.map((row) => row.project_id))) {
        const secrets = await this.listProjectSecrets(projectId);

        for (const [id, secret] of secrets) {
          if (phaseOf(secret) === 'provisioning') {
            this.follow(
              id,
              new Date(
                secret.metadata?.creationTimestamp ?? Date.now(),
              ).getTime(),
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Could not resume S3 bucket provisioning: ${describeError(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  private get target(): RustfsTarget {
    return rustfsTarget();
  }

  private get endpoint(): string {
    return rustfsS3Endpoint();
  }

  async list(projectId: string): Promise<Workload[]> {
    const rows = await this.db
      .select()
      .from(workload)
      .where(
        and(eq(workload.project_id, projectId), eq(workload.type, this.type)),
      )
      .orderBy(asc(workload.created_at));

    if (rows.length === 0) {
      return [];
    }

    const [active, secrets] = await Promise.all([
      this.versions.findByIds(
        rows.flatMap((row) =>
          row.active_version_id === null ? [] : [row.active_version_id],
        ),
      ),
      this.listProjectSecrets(projectId),
    ]);

    return rows.map((row) =>
      this.toWorkload(
        row,
        row.active_version_id === null
          ? null
          : (active.get(row.active_version_id) ?? null),
        secrets.get(row.id) ?? null,
      ),
    );
  }

  async create(
    projectId: string,
    payload: CreateWorkloadPayload,
  ): Promise<Workload> {
    if (!(await this.projectService.exists(projectId))) {
      throw new NotFoundException('Project not found');
    }

    if (payload?.type !== this.type) {
      throw new BadRequestException('Unsupported workload type');
    }

    const bucket = normalizeBucketName(payload?.name);
    const config: S3BucketConfig = normalizeBucketConfig(payload?.config);
    const id = randomUUID();
    let row: WorkloadRow;

    try {
      [row] = await this.db
        .insert(workload)
        .values({
          id,
          project_id: projectId,
          name: bucket,
          type: this.type,
          draft_config: null,
          position: await nextWorkloadPosition(this.db, projectId),
          external_name: bucket,
          last_deployed_at: new Date(),
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(BUCKET_TAKEN_MESSAGE);
      }

      throw error;
    }

    const keys = generateBucketKeys();
    const namespace = projectNamespace(projectId);

    try {
      await this.versions.record({ id: randomUUID(), workloadId: id, config });
      await this.isolation.ensure(projectId);
      await this.upsertProjectSecret(
        buildProjectSecret({
          workloadId: id,
          projectId,
          namespace,
          bucket,
          endpoint: this.endpoint,
          keys,
          phase: 'provisioning',
        }),
      );

      const input: BucketJobInput = {
        workloadId: id,
        projectId,
        bucket,
        operation: 'create',
        target: this.target,
      };
      const job = await this.startJob(input);

      await this.kubernetes.coreV1.createNamespacedSecret({
        namespace: this.target.namespace,
        body: buildJobSecret(input, keys, {
          name: job.metadata!.name!,
          uid: job.metadata!.uid!,
        }),
      });
    } catch (error) {
      // Nothing usable exists yet: drop what was made so the name is free to
      // try again, and report why.
      await this.ignoreNotFound(() =>
        this.kubernetes.coreV1.deleteNamespacedSecret({
          name: projectSecretName(bucket),
          namespace,
        }),
      ).catch(() => undefined);
      await this.ignoreNotFound(() =>
        this.kubernetes.batchV1.deleteNamespacedJob({
          name: bucketJobName(id, 'create'),
          namespace: this.target.namespace,
          propagationPolicy: 'Background',
        }),
      ).catch(() => undefined);
      await this.db.delete(workload).where(eq(workload.id, id));

      throw this.mapClusterError(error);
    }

    this.follow(id, Date.now());

    return this.get(projectId, row.id);
  }

  async get(projectId: string, id: string): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const [active, secret] = await Promise.all([
      this.activeVersion(row),
      this.readProjectSecret(row),
    ]);

    return this.toWorkload(row, active, secret);
  }

  async credentials(
    projectId: string,
    id: string,
  ): Promise<S3BucketCredentials> {
    const row = await this.findRow(projectId, id);
    let secret: V1Secret | null;

    try {
      secret = await this.readProjectSecret(row);
    } catch (error) {
      throw this.mapClusterError(error);
    }

    const access = secret ? this.toAccess(row, secret) : null;
    const secretAccessKey = secret
      ? decode(secret, 'AWS_SECRET_ACCESS_KEY')
      : undefined;

    if (!access || !secretAccessKey) {
      throw new NotFoundException('Bucket keys not found in the cluster');
    }

    return { ...access, secret_access_key: secretAccessKey };
  }

  /** The bucket name of a bucket whose contents can be read and written. */
  async readyBucket(projectId: string, id: string): Promise<string> {
    const row = await this.findRow(projectId, id);
    const { status } = bucketStatus(await this.readProjectSecret(row));

    if (status !== 'running') {
      throw new ConflictException(
        status === 'deploying'
          ? 'The bucket is still being created'
          : 'The bucket is not available',
      );
    }

    return row.external_name;
  }

  /**
   * Replaces the bucket's keys. RustFS registers the new pair and removes
   * every old one; only once it confirms does the project Secret get the new
   * pair, so the Secret never holds keys RustFS does not know. Services read the Secret when they start, so
   * they keep the old keys, which stop working, until they restart.
   */
  async rotateCredentials(
    projectId: string,
    id: string,
  ): Promise<S3BucketCredentials> {
    const row = await this.findRow(projectId, id);

    if (bucketStatus(await this.readProjectSecret(row)).status !== 'running') {
      throw new ConflictException(
        'Keys can be regenerated once the bucket is ready',
      );
    }

    if (this.rotating.has(row.id)) {
      throw new ConflictException('The keys are already being regenerated');
    }

    this.rotating.add(row.id);

    try {
      const keys = generateBucketKeys();
      const input: BucketJobInput = {
        workloadId: row.id,
        projectId,
        bucket: row.external_name,
        operation: 'rotate',
        target: this.target,
      };

      try {
        const job = await this.startJob(input);

        await this.kubernetes.coreV1.createNamespacedSecret({
          namespace: this.target.namespace,
          body: buildJobSecret(input, keys, {
            name: job.metadata!.name!,
            uid: job.metadata!.uid!,
          }),
        });
      } catch (error) {
        throw this.mapClusterError(error);
      }

      const result = await this.waitForJob(row.id, 'rotate');

      if (result.outcome === 'running') {
        throw new ServiceUnavailableException(
          'Object storage is still applying the new keys. Try again in a minute.',
        );
      }

      if (result.outcome === 'failed') {
        throw new ConflictException(
          `Could not regenerate the keys: ${result.message}`,
        );
      }

      try {
        await this.upsertProjectSecret(
          buildProjectSecret({
            workloadId: row.id,
            projectId,
            namespace: projectNamespace(projectId),
            bucket: row.external_name,
            endpoint: this.endpoint,
            keys,
            phase: 'ready',
          }),
        );
      } catch (error) {
        this.logger.warn(
          `New keys of bucket ${row.external_name} were not saved: ${describeError(error)}`,
        );

        throw new ServiceUnavailableException(
          'Object storage has new keys, but they could not be saved. Regenerate them again.',
        );
      }

      await this.ignoreNotFound(() =>
        this.kubernetes.batchV1.deleteNamespacedJob({
          name: bucketJobName(row.id, 'rotate'),
          namespace: this.target.namespace,
          propagationPolicy: 'Background',
        }),
      ).catch(() => undefined);

      return this.credentials(projectId, id);
    } finally {
      this.rotating.delete(row.id);
    }
  }

  async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    const existing = await this.findRow(projectId, id);

    if (
      (payload?.name !== undefined && payload.name !== existing.name) ||
      payload?.config !== undefined
    ) {
      throw new BadRequestException(LOCKED_BUCKET_MESSAGE);
    }

    if (payload?.position === undefined) {
      return this.get(projectId, id);
    }

    const position = normalizeWorkloadPosition(payload.position);

    if (
      position.x === existing.position.x &&
      position.y === existing.position.y
    ) {
      return this.get(projectId, id);
    }

    const [row] = await this.db
      .update(workload)
      .set({ position })
      .where(eq(workload.id, existing.id))
      .returning();

    this.events.publish({
      type: 'position',
      workload_id: row.id,
      project_id: row.project_id,
      position: row.position,
      updated_at: row.updated_at.toISOString(),
    });

    return this.get(projectId, id);
  }

  /**
   * Deletes the bucket with its data and its keys in RustFS, then the
   * Secret and the row. The row stays when RustFS does not confirm,
   * so a bucket is never forgotten while its data still exists.
   */
  async remove(projectId: string, id: string): Promise<void> {
    const row = await this.findRow(projectId, id);
    const input: BucketJobInput = {
      workloadId: row.id,
      projectId,
      bucket: row.external_name,
      operation: 'delete',
      target: this.target,
    };

    this.stopFollowing(row.id);

    try {
      await this.startJob(input);
    } catch (error) {
      throw this.mapClusterError(error);
    }

    const result = await this.waitForJob(input.workloadId, 'delete');

    if (result.outcome === 'running') {
      throw new ServiceUnavailableException(
        'Object storage is still deleting the bucket. Try again in a minute.',
      );
    }

    if (result.outcome === 'failed') {
      throw new ConflictException(
        `Could not delete the bucket: ${result.message}`,
      );
    }

    try {
      await this.ignoreNotFound(() =>
        this.kubernetes.coreV1.deleteNamespacedSecret({
          name: projectSecretName(row.external_name),
          namespace: projectNamespace(projectId),
        }),
      );
      for (const operation of ['create', 'rotate'] as const) {
        await this.ignoreNotFound(() =>
          this.kubernetes.batchV1.deleteNamespacedJob({
            name: bucketJobName(row.id, operation),
            namespace: this.target.namespace,
            propagationPolicy: 'Background',
          }),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Bucket ${row.external_name} is deleted but cleanup failed: ${describeError(error)}`,
      );
    }

    await this.db
      .delete(workload)
      .where(and(eq(workload.id, id), eq(workload.project_id, projectId)));
  }

  async listVersions(
    projectId: string,
    id: string,
  ): Promise<WorkloadVersionContract[]> {
    const row = await this.findRow(projectId, id);

    return (await this.versions.list(row.id)).map(toWorkloadVersion);
  }

  async getVersion(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersionContract> {
    const row = await this.findRow(projectId, id);

    return toWorkloadVersion(await this.versions.get(row.id, versionId));
  }

  async diffVersions(
    projectId: string,
    id: string,
    base: string,
    target: string,
  ): Promise<WorkloadVersionDiff> {
    const row = await this.findRow(projectId, id);
    const [left, right] = await Promise.all([
      this.versions.resolveSide(row, base),
      this.versions.resolveSide(row, target),
    ]);
    return buildDiff({
      workloadId: row.id,
      type: this.type,
      base: left.side,
      target: right.side,
      // A bucket has no settings that change after creation.
      sections: [],
    });
  }

  previewRollback(): Promise<WorkloadVersionDiff> {
    return this.unsupported();
  }

  deploy(): Promise<Workload> {
    return this.unsupported();
  }

  start(): Promise<Workload> {
    return this.unsupported();
  }

  stop(): Promise<Workload> {
    return this.unsupported();
  }

  restart(): Promise<Workload> {
    return this.unsupported();
  }

  rollback(): Promise<Workload> {
    return this.unsupported();
  }

  discardDraft(): Promise<Workload> {
    return this.unsupported();
  }

  private unsupported(): Promise<never> {
    return Promise.reject(new BadRequestException(UNSUPPORTED_ACTION_MESSAGE));
  }

  /** Replaces a Job left from an earlier attempt, then starts this one. */
  private startJob(input: BucketJobInput): Promise<V1Job> {
    return startBucketJob(this.kubernetes, input);
  }

  /** Waits for a Job; a failure carries the message the Job left. */
  private async waitForJob(
    workloadId: string,
    operation: BucketOperation,
  ): Promise<
    | { outcome: 'succeeded' | 'running' }
    | { outcome: 'failed'; message: string }
  > {
    const name = bucketJobName(workloadId, operation);
    const deadline = Date.now() + DELETE_WAIT_MS;

    while (Date.now() < deadline) {
      const job = await this.readJob(name).catch(() => null);
      const outcome = job === null ? 'running' : jobOutcome(job);

      if (outcome === 'succeeded') {
        return { outcome };
      }

      if (outcome === 'failed') {
        return {
          outcome,
          message: bucketErrorFromLog(await this.readLog(name)),
        };
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    return { outcome: 'running' };
  }

  /** Polls the create Job until it ends and records the outcome. */
  private follow(id: string, startedAt: number): void {
    this.stopFollowing(id);

    const tick = async () => {
      this.timers.delete(id);

      try {
        const done = await this.checkCreate(id, startedAt);

        if (!done) {
          this.schedule(id, tick);
        }
      } catch (error) {
        this.logger.warn(
          `Polling bucket ${id} failed: ${describeError(error)}`,
        );
        this.schedule(id, tick);
      }
    };

    this.schedule(id, tick);
  }

  private schedule(id: string, tick: () => Promise<void>): void {
    const timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);

    timer.unref();
    this.timers.set(id, timer);
  }

  private stopFollowing(id: string): void {
    const timer = this.timers.get(id);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /** True once the bucket left `provisioning`, or there is nothing to follow. */
  private async checkCreate(id: string, startedAt: number): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(workload)
      .where(and(eq(workload.id, id), eq(workload.type, this.type)))
      .limit(1);

    if (!row) {
      return true;
    }

    const secret = await this.readProjectSecret(row);

    if (secret === null || phaseOf(secret) !== 'provisioning') {
      return true;
    }

    const name = bucketJobName(id, 'create');
    const job = await this.readJob(name);

    if (job === null) {
      await this.recordPhase(
        row,
        secret,
        'failed',
        'The provisioning Job is gone from the cluster',
      );

      return true;
    }

    const outcome = jobOutcome(job);

    if (outcome === 'succeeded') {
      await this.recordPhase(row, secret, 'ready', null);

      return true;
    }

    if (outcome === 'failed') {
      await this.recordPhase(
        row,
        secret,
        'failed',
        bucketErrorFromLog(await this.readLog(name)),
      );

      return true;
    }

    if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
      await this.recordPhase(
        row,
        secret,
        'failed',
        'Object storage did not create the bucket in time',
      );

      return true;
    }

    return false;
  }

  /**
   * Writes the outcome of the create Job onto the bucket's Secret and tells
   * the consoles. The Secret is replaced at the version that was read, so a
   * concurrent key rotation makes this write fail and be retried instead of
   * being overwritten.
   */
  private async recordPhase(
    row: WorkloadRow,
    secret: V1Secret,
    phase: BucketPhase,
    message: string | null,
  ): Promise<void> {
    const annotations = { ...secret.metadata?.annotations };

    annotations[BUCKET_PHASE_ANNOTATION] = phase;

    if (message === null) {
      delete annotations[BUCKET_MESSAGE_ANNOTATION];
    } else {
      annotations[BUCKET_MESSAGE_ANNOTATION] = message;
    }

    const updated = await this.kubernetes.coreV1.replaceNamespacedSecret({
      name: secret.metadata!.name!,
      namespace: secret.metadata!.namespace!,
      body: { ...secret, metadata: { ...secret.metadata, annotations } },
    });
    const view = bucketStatus(updated);

    this.events.publish({
      type: 'status',
      workload_id: row.id,
      project_id: row.project_id,
      status: view.status,
      status_message: view.status_message,
      status_observed_at: view.status_observed_at,
      updated_at: row.updated_at.toISOString(),
    });
  }

  private readJob(name: string): Promise<V1Job | null> {
    return readBucketJob(this.kubernetes, name, this.target.namespace);
  }

  private readLog(name: string): Promise<string | null> {
    return readBucketJobLog(this.kubernetes, name, this.target.namespace);
  }

  private async upsertProjectSecret(body: V1Secret): Promise<void> {
    const name = body.metadata!.name!;
    const namespace = body.metadata!.namespace!;

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

  private async readProjectSecret(row: WorkloadRow): Promise<V1Secret | null> {
    try {
      const secret = await this.kubernetes.coreV1.readNamespacedSecret({
        name: projectSecretName(row.external_name),
        namespace: projectNamespace(row.project_id),
      });

      // A Secret of that name that this bucket did not write is not its keys.
      return secret.metadata?.labels?.[BUCKET_WORKLOAD_LABEL] === row.id
        ? secret
        : null;
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return null;
      }

      this.logger.warn(
        `Could not read keys of bucket ${row.external_name}: ${describeError(error)}`,
      );

      return null;
    }
  }

  /** One request per project: every bucket Secret by label. */
  private async listProjectSecrets(
    projectId: string,
  ): Promise<Map<string, V1Secret>> {
    try {
      const secrets = await this.kubernetes.coreV1.listNamespacedSecret({
        namespace: projectNamespace(projectId),
        labelSelector: `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE},${BUCKET_WORKLOAD_LABEL}`,
      });

      return new Map(
        secrets.items.flatMap((secret) => {
          const id = secret.metadata?.labels?.[BUCKET_WORKLOAD_LABEL];

          return id ? [[id, secret] as const] : [];
        }),
      );
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        this.logger.warn(
          `Could not list bucket keys of project ${projectId}: ${describeError(error)}`,
        );
      }

      return new Map();
    }
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

  private mapClusterError(error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    this.logger.warn(`Kubernetes request failed: ${describeError(error)}`);

    return toNestException(error);
  }

  private async findRow(projectId: string, id: string): Promise<WorkloadRow> {
    const [row] = await this.db
      .select()
      .from(workload)
      .where(
        and(
          eq(workload.id, id),
          eq(workload.project_id, projectId),
          eq(workload.type, this.type),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Workload not found');
    }

    return row;
  }

  private async activeVersion(
    row: WorkloadRow,
  ): Promise<WorkloadVersionRow | null> {
    if (row.active_version_id === null) {
      return null;
    }

    const found = await this.versions.findByIds([row.active_version_id]);

    return found.get(row.active_version_id) ?? null;
  }

  private toAccess(row: WorkloadRow, secret: V1Secret): S3BucketAccess | null {
    const accessKeyId = decode(secret, 'AWS_ACCESS_KEY_ID');

    if (!accessKeyId) {
      return null;
    }

    return {
      bucket: row.external_name,
      endpoint: decode(secret, 'AWS_ENDPOINT_URL') ?? this.endpoint,
      region: decode(secret, 'AWS_REGION') ?? S3_REGION,
      access_key_id: accessKeyId,
      secret_name:
        secret.metadata?.name ?? projectSecretName(row.external_name),
    };
  }

  private toWorkload(
    row: WorkloadRow,
    active: WorkloadVersionRow | null,
    secret: V1Secret | null,
  ): Workload {
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      type: row.type,
      active_version: active === null ? null : toWorkloadVersion(active),
      draft_config: null,
      position: row.position,
      ...bucketStatus(secret),
      external_name: row.external_name,
      namespace: projectNamespace(row.project_id),
      last_deployed_at: row.last_deployed_at?.toISOString() ?? null,
      icon: row.icon,
      s3: secret ? this.toAccess(row, secret) : null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
