import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { V1Deployment } from '@kubernetes/client-node';
import type {
  CreateWorkloadPayload,
  DockerWorkloadConfig,
  DockerWorkloadVolume,
  EnvVar,
  WorkloadEnv,
  UpdateInternalHostnamePayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadConfig,
  WorkloadPosition,
  WorkloadStatus,
  WorkloadVersionDiff,
} from '@acceleratio/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { WorkloadVersion as WorkloadVersionContract } from '@acceleratio/shared';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import { StorageClassService } from '@/application/storage-class/storage-class.service';
import {
  CONFLICT_ID_PREFIX_LENGTH,
  DEFAULT_SLUG_LENGTH,
  internalDomain,
  projectNamespace,
  workloadExternalName,
} from '@/common/naming';
import { normalizeName } from '@/common/validation';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { WorkloadEventsService } from '@/application/workload/observer/workload-events.service';
import { WorkloadMutationGuard } from '@/application/workload/observer/workload-mutation-guard';
import {
  workload,
  type WorkloadRow,
} from '@/application/workload/schemas/workload.schema';
import type { WorkloadVersionRow } from '@/application/workload/schemas/workload-version.schema';
import type { WorkloadTypeService } from '@/application/workload/workload-type-service';
import {
  nextWorkloadPosition,
  normalizeWorkloadPosition,
} from '@/application/workload/workload-position';
import {
  sameConfig,
  toWorkloadVersion,
  type VersionAuthorInput,
  WorkloadVersionService,
} from '@/application/workload/workload-version.service';
import { buildDiff } from '@/application/workload/workload-version.diff';
import { diffDockerConfigs } from './docker-workload.diff';
import {
  DEFAULT_REPLICAS,
  newDockerConfig,
  normalizeDockerConfig,
  omitsEnv,
  omitsVolumes,
  redactDockerConfig,
} from './docker-workload.config';
import { DockerWorkloadNetworkService } from './docker-workload-network.service';
import {
  INTERNAL_HOSTNAME_CONSTRAINT,
  pickInternalHostname,
} from './docker-workload-network.internal';
import {
  buildDeployment,
  buildEnvSecret,
  buildVolumeClaim,
  envSecretNameOf,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  envSecretPrefix,
  RESTARTED_AT_ANNOTATION,
  VOLUME_ID_LABEL,
  WORKLOAD_ID_LABEL,
  type WorkloadManifestInput,
} from './docker-workload.manifests';

const UNIQUE_VIOLATION = '23505';
const EXTERNAL_NAME_CONSTRAINT = 'workload_project_id_external_name_unique';
const NOT_DEPLOYED_MESSAGE = 'Workload is not deployed yet';
const NO_CONFIG_MESSAGE = 'Workload has no config to deploy';
const ALREADY_ACTIVE_MESSAGE = 'Version is already active';
const ONLY_DRAFT_MESSAGE =
  'Workload has never been deployed; its draft is its only config';
const UNSUPPORTED_TYPE_MESSAGE = 'Unsupported workload type';
const VOLUME_FIXED_MESSAGE =
  'The size and storage profile of a volume cannot change after it is created';
const UNKNOWN_VOLUME_MESSAGE = 'Unknown volume';
/** How often a claim that pods still mount is checked again after a deploy. */
export const VOLUME_PRUNE_RETRY_MS = 10_000;
/** Retries cover the rollout deadline, then the sweep takes over. */
export const VOLUME_PRUNE_MAX_ATTEMPTS = 36;
/** First orphan sweep after start, then this often. */
export const VOLUME_SWEEP_DELAY_MS = 30_000;
export const VOLUME_SWEEP_INTERVAL_MS = 10 * 60_000;

const sweepEnabled = (): boolean =>
  process.env.VOLUME_SWEEP_ENABLED?.trim().toLowerCase() !== 'false';

/** What one apply writes to the cluster and records afterwards. */
interface ApplyPlan {
  config: DockerWorkloadConfig;
  /** Existing version to reapply, or the id for a new one. */
  versionId: string;
  /** True when the apply creates a version instead of reapplying one. */
  newVersion: boolean;
  sourceVersionId?: string | null;
  /** Recorded on the new version. */
  author?: VersionAuthorInput | null;
  /** Draft the apply consumes; cleared afterwards if nobody edited it. */
  appliedDraft?: DockerWorkloadConfig;
}

interface WorkloadState {
  status: WorkloadStatus;
  status_message: string | null;
  last_deployed_at?: Date;
}

/**
 * Drizzle wraps driver failures, so the PostgreSQL error code and constraint
 * name can sit on the error or on one of its causes.
 */
const uniqueConstraintOf = (error: unknown): string | undefined | null => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (
    typeof current === 'object' &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };

    if (candidate.code === UNIQUE_VIOLATION) {
      return typeof candidate.constraint === 'string'
        ? candidate.constraint
        : undefined;
    }

    current = candidate.cause;
  }

  return null;
};

const isInternalHostnameConflict = (error: unknown): boolean =>
  uniqueConstraintOf(error) === INTERNAL_HOSTNAME_CONSTRAINT;

const isExternalNameConflict = (error: unknown): boolean => {
  const constraint = uniqueConstraintOf(error);

  // Without a constraint name the conflict is taken to be the external name,
  // the only unique key a create could hit before private names existed.
  return (
    constraint !== null &&
    (constraint === undefined || constraint === EXTERNAL_NAME_CONSTRAINT)
  );
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Complete Docker workload type: rows, external names, manifests, Deployment
 * lifecycle and the mapping to the API contract.
 *
 * Reads are pure database queries. The observer owns status derivation and
 * writes; lifecycle actions here only record the optimistic state.
 *
 * Every query is scoped to `type = 'docker'`; other types own their own
 * services and never pass through this one.
 */
@Injectable()
export class DockerWorkloadService
  implements WorkloadTypeService, OnApplicationBootstrap, OnApplicationShutdown
{
  readonly type = 'docker' as const;

  private readonly logger = new Logger(DockerWorkloadService.name);

  /** Tail of the cluster writes queued per workload; see `exclusive`. */
  private readonly queues = new Map<string, Promise<unknown>>();

  private sweepTimer?: ReturnType<typeof setTimeout>;
  private sweepInterval?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectService: ProjectService,
    private readonly isolation: ProjectIsolationService,
    private readonly kubernetes: KubernetesService,
    private readonly guard: WorkloadMutationGuard,
    private readonly events: WorkloadEventsService,
    private readonly versions: WorkloadVersionService,
    private readonly network: DockerWorkloadNetworkService,
    private readonly storageClasses: StorageClassService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.WORKLOAD_INTERNAL_BACKFILL !== '0') {
      void this.backfillPrivateNetwork();
    }

    if (!sweepEnabled()) {
      return;
    }

    const run = () => {
      void this.sweepVolumeClaims().catch((error: unknown) => {
        this.logger.warn(
          `Could not sweep volume claims: ${describeError(error)}`,
        );
      });
    };

    this.sweepTimer = setTimeout(run, VOLUME_SWEEP_DELAY_MS);
    this.sweepTimer.unref?.();
    this.sweepInterval = setInterval(run, VOLUME_SWEEP_INTERVAL_MS);
    this.sweepInterval.unref?.();
  }

  /**
   * Services created before private names existed get a hostname, and the
   * deployed ones their headless Service, without a redeploy. Each row runs
   * in its write queue, like a deploy. Runs in the background: the cluster
   * may be unreachable at startup, and the next deploy writes it anyway.
   */
  async backfillPrivateNetwork(): Promise<void> {
    let rows: WorkloadRow[];

    try {
      rows = await this.db
        .select()
        .from(workload)
        .where(eq(workload.type, this.type));
    } catch (error) {
      // The API starts before migrations in local development.
      this.logger.warn(
        `Could not list services for private names: ${describeError(error)}`,
      );
      return;
    }

    let dnsReady = false;

    for (const { id, project_id: projectId } of rows) {
      try {
        await this.exclusive(id, async () => {
          const row = await this.network.assignInternalHostname(
            await this.findRow(projectId, id),
          );

          if (row.last_deployed_at === null) {
            return;
          }

          if (!dnsReady) {
            await this.network.ensureDnsRule();
            dnsReady = true;
          }

          await this.network.ensureInternalService(row);
        });
      } catch (error) {
        // A missing row or namespace means it is gone or being deleted.
        if (
          !(error instanceof NotFoundException) &&
          getKubernetesStatusCode(error) !== 404
        ) {
          this.logger.warn(
            `Could not set up the private name of workload ${id}: ${describeError(error)}`,
          );
        }
      }
    }
  }

  /** Renames the private hostname at once, in the workload's write queue. */
  async updateInternalHostname(
    projectId: string,
    id: string,
    payload: UpdateInternalHostnamePayload,
  ): Promise<Workload> {
    const { id: workloadId } = await this.findRow(projectId, id);

    return this.exclusive(workloadId, async () => {
      const row = await this.network.renameInternalHostname(
        await this.findRow(projectId, id),
        payload,
      );

      return this.present(row);
    });
  }

  onApplicationShutdown(): void {
    clearTimeout(this.sweepTimer);
    clearInterval(this.sweepInterval);
  }

  /**
   * Deletes claims that no config needs any more: left by a deploy that
   * failed after creating them and whose draft was then discarded, or kept
   * for old pods while the API restarted. A claim stays while the active
   * version or the draft lists its volume, or while pods mount it.
   *
   * Claims of services this database does not know are never touched: a
   * second installation, or a development API pointed at a shared cluster,
   * labels its claims the same way.
   */
  async sweepVolumeClaims(): Promise<void> {
    const claims =
      await this.kubernetes.coreV1.listPersistentVolumeClaimForAllNamespaces({
        labelSelector: `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE},${VOLUME_ID_LABEL}`,
      });
    const workloadIds = [
      ...new Set(
        claims.items.flatMap((claim) => {
          const id = claim.metadata?.labels?.[WORKLOAD_ID_LABEL];

          return id ? [id] : [];
        }),
      ),
    ];

    if (workloadIds.length === 0) {
      return;
    }

    const rows = await this.db
      .select()
      .from(workload)
      .where(
        and(inArray(workload.id, workloadIds), eq(workload.type, this.type)),
      );

    for (const row of rows) {
      await this.exclusive(row.id, async () => {
        const [fresh] = await this.db
          .select()
          .from(workload)
          .where(eq(workload.id, row.id))
          .limit(1);

        if (!fresh) {
          return;
        }

        const active = await this.activeVersion(fresh);
        const keep = new Set(
          [
            ...((active?.config as DockerWorkloadConfig | undefined)?.volumes ??
              []),
            ...((fresh.draft_config as DockerWorkloadConfig | null)?.volumes ??
              []),
          ].map((volume) => volume.id!),
        );

        await this.pruneVolumeClaims(fresh, keep);
      });
    }
  }

  async list(projectId: string): Promise<Workload[]> {
    const rows = await this.db
      .select()
      .from(workload)
      .where(
        and(eq(workload.project_id, projectId), eq(workload.type, this.type)),
      )
      .orderBy(asc(workload.created_at));
    const active = await this.versions.findByIds(
      rows.flatMap((row) =>
        row.active_version_id === null ? [] : [row.active_version_id],
      ),
    );

    return rows.map((row) =>
      this.toWorkload(
        row,
        row.active_version_id === null
          ? null
          : (active.get(row.active_version_id) ?? null),
      ),
    );
  }

  async create(
    projectId: string,
    payload: CreateWorkloadPayload,
  ): Promise<Workload> {
    // The insert relies on a foreign key, so a missing project would surface as
    // a database error instead of a 404. This is the only place that needs the
    // check; every other query already filters by project_id.
    if (!(await this.projectService.exists(projectId))) {
      throw new NotFoundException('Project not found');
    }

    if (payload?.type !== this.type) {
      throw new BadRequestException(UNSUPPORTED_TYPE_MESSAGE);
    }

    const name = normalizeName(payload?.name);
    const config = newDockerConfig(payload?.config);

    // A new service has no volumes yet, so every one it brings is new.
    await this.reconcileVolumes(config, []);
    const position = await nextWorkloadPosition(this.db, projectId);
    // The id is generated here rather than by the database so external_name can
    // be computed before the single insert statement.
    const id = randomUUID();
    const values = {
      id,
      project_id: projectId,
      name,
      type: this.type,
      // Nothing is applied yet, so the whole config is pending.
      draft_config: config,
      position,
      external_name: workloadExternalName(name, id),
    };

    // Two services created at once can pick the same private hostname; the
    // unique constraint catches it and the loser picks again.
    for (let attempt = 1; ; attempt += 1) {
      const taken = await this.network.takenServiceNames(projectId);
      const internal = {
        ...values,
        internal_hostname: pickInternalHostname(name, taken),
      };

      try {
        return await this.insertNew(internal, name, id);
      } catch (error) {
        if (attempt >= 3 || !isInternalHostnameConflict(error)) {
          throw error;
        }
      }
    }
  }

  /** Inserts a new row, retrying once with a longer external name suffix. */
  private async insertNew(
    values: typeof workload.$inferInsert,
    name: string,
    id: string,
  ): Promise<Workload> {
    try {
      const [row] = await this.db.insert(workload).values(values).returning();

      return this.toWorkload(row, null);
    } catch (error) {
      if (!isExternalNameConflict(error)) {
        throw error;
      }
    }

    try {
      const [row] = await this.db
        .insert(workload)
        .values({
          ...values,
          external_name: workloadExternalName(
            name,
            id,
            DEFAULT_SLUG_LENGTH,
            CONFLICT_ID_PREFIX_LENGTH,
          ),
        })
        .returning();

      return this.toWorkload(row, null);
    } catch (error) {
      if (isExternalNameConflict(error)) {
        throw new ConflictException(
          'Workload name is already used in this project',
        );
      }

      throw error;
    }
  }

  async get(projectId: string, id: string): Promise<Workload> {
    return this.present(await this.findRow(projectId, id));
  }

  async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    const existing = await this.findRow(projectId, id);
    const updates: {
      name?: string;
      draft_config?: WorkloadConfig | null;
      position?: WorkloadPosition;
    } = {};
    const active = await this.activeVersion(existing);

    if (payload?.name !== undefined) {
      updates.name = normalizeName(payload.name);
    }

    if (payload?.config !== undefined) {
      const config = normalizeDockerConfig(payload.config);

      // Responses never carry values, so a client editing other settings
      // cannot send them back. Leaving `env` out keeps what is stored.
      if (omitsEnv(payload.config)) {
        const kept = this.effectiveEnv(existing, active);

        if (kept.length > 0) {
          config.env = kept;
        }
      }
      if (omitsVolumes(payload.config)) {
        const kept = this.effectiveVolumes(existing, active);

        if (kept.length > 0) {
          config.volumes = kept;
        }
      }

      await this.reconcileVolumes(config, [
        ...((active?.config as DockerWorkloadConfig | undefined)?.volumes ??
          []),
        ...((existing.draft_config as DockerWorkloadConfig | null)?.volumes ??
          []),
      ]);

      // Editing back to the applied config leaves nothing to deploy.
      const draft =
        active !== null && sameConfig(config, active.config) ? null : config;

      if (!sameConfig(draft, existing.draft_config)) {
        updates.draft_config = draft;
      }
    }

    if (payload?.position !== undefined) {
      const position = normalizeWorkloadPosition(payload.position);

      // A drop that lands on the stored coordinates is a no-op: do not bump
      // `updated_at` or wake every other canvas with an identical event.
      if (
        position.x !== existing.position.x ||
        position.y !== existing.position.y
      ) {
        updates.position = position;
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.toWorkload(existing, active);
    }

    const [row] = await this.db
      .update(workload)
      .set(updates)
      .where(eq(workload.id, existing.id))
      .returning();
    const updated = this.toWorkload(row, active);

    if (updates.position !== undefined) {
      this.events.publish({
        type: 'position',
        workload_id: updated.id,
        project_id: updated.project_id,
        position: updated.position,
        updated_at: updated.updated_at,
      });
    }

    return updated;
  }

  /**
   * Applies the draft as a new version, or reapplies the active version when
   * there is no draft.
   */
  async deploy(
    projectId: string,
    id: string,
    author?: VersionAuthorInput | null,
  ): Promise<Workload> {
    const { id: workloadId } = await this.findRow(projectId, id);

    // Reads happen inside the queue, so they see what an earlier apply left.
    return this.exclusive(workloadId, async () => {
      const row = await this.findRow(projectId, id);
      const active = await this.activeVersion(row);
      const draft =
        row.draft_config === null
          ? null
          : normalizeDockerConfig(row.draft_config);

      if (draft === null && active === null) {
        throw new ConflictException(NO_CONFIG_MESSAGE);
      }

      if (
        draft !== null &&
        (active === null || !sameConfig(draft, active.config))
      ) {
        return this.applyNow(row, {
          config: draft,
          versionId: randomUUID(),
          newVersion: true,
          appliedDraft: draft,
          author,
        });
      }

      // Either no draft, or a draft that equals the applied config (left over
      // after a rollback moved the active version under it).
      return this.applyNow(row, {
        config: normalizeDockerConfig(active!.config),
        versionId: active!.id,
        newVersion: false,
        ...(draft !== null ? { appliedDraft: draft } : {}),
      });
    });
  }

  /**
   * Starting a stopped workload reapplies the active version. Pending draft
   * changes are left for an explicit deploy.
   */
  async start(projectId: string, id: string): Promise<Workload> {
    const { id: workloadId } = await this.findRow(projectId, id);

    // Reads happen inside the queue, so they see what an earlier apply left.
    return this.exclusive(workloadId, async () => {
      const row = await this.findRow(projectId, id);
      const active = await this.activeVersion(row);

      if (active === null) {
        throw new ConflictException(NOT_DEPLOYED_MESSAGE);
      }

      return this.applyNow(row, {
        config: normalizeDockerConfig(active.config),
        versionId: active.id,
        newVersion: false,
      });
    });
  }

  /**
   * Applies the config of an earlier version as a new version. History only
   * grows; the draft is left untouched.
   */
  async rollback(
    projectId: string,
    id: string,
    versionId: string,
    author?: VersionAuthorInput | null,
  ): Promise<Workload> {
    const { id: workloadId } = await this.findRow(projectId, id);

    return this.exclusive(workloadId, async () => {
      const row = await this.findRow(projectId, id);
      const target = await this.versions.get(row.id, versionId);

      if (target.id === row.active_version_id) {
        throw new ConflictException(ALREADY_ACTIVE_MESSAGE);
      }

      const active = await this.activeVersion(row);

      return this.applyNow(row, {
        config: this.rollbackConfig(target, active),
        versionId: randomUUID(),
        newVersion: true,
        sourceVersionId: target.id,
        author,
      });
    });
  }

  /**
   * What the two sides differ in: a version, the draft or the active version
   * against another. Variable values are compared here and never returned.
   */
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
      sections: diffDockerConfigs(
        left.config && normalizeDockerConfig(left.config),
        right.config && normalizeDockerConfig(right.config),
      ),
    });
  }

  /**
   * What a rollback to the version would change on the running service: the
   * config it really applies (with the current volumes) against the active
   * version.
   */
  async previewRollback(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersionDiff> {
    const row = await this.findRow(projectId, id);
    const target = await this.versions.get(row.id, versionId);

    if (target.id === row.active_version_id) {
      throw new ConflictException(ALREADY_ACTIVE_MESSAGE);
    }

    const active = await this.activeVersion(row);
    const restored = normalizeDockerConfig(target.config);
    const applied = this.rollbackConfig(target, active);
    const keepsVolumes = !sameConfig(
      { volumes: restored.volumes ?? [] } as DockerWorkloadConfig,
      { volumes: applied.volumes ?? [] } as DockerWorkloadConfig,
    );

    return buildDiff({
      workloadId: row.id,
      type: this.type,
      base:
        active === null
          ? { kind: 'none' }
          : { kind: 'version', version_id: active.id, number: active.number },
      target: { kind: 'version', version_id: target.id, number: target.number },
      sections: diffDockerConfigs(
        active && normalizeDockerConfig(active.config),
        applied,
      ),
      notes: keepsVolumes
        ? [
            `v${target.number} had different volumes. A rollback keeps the volumes the service has now and their data.`,
          ]
        : [],
    });
  }

  /**
   * Rollback never touches volumes: the version it restores runs with the
   * volumes the service has now, so no claim is created or deleted and no
   * data comes back empty or goes away.
   */
  private rollbackConfig(
    target: WorkloadVersionRow,
    active: WorkloadVersionRow | null,
  ): DockerWorkloadConfig {
    const config = normalizeDockerConfig(target.config);

    delete config.volumes;
    const current = (active?.config as DockerWorkloadConfig | undefined)
      ?.volumes;

    return current?.length ? { ...config, volumes: current } : config;
  }

  async listVersions(
    projectId: string,
    id: string,
  ): Promise<WorkloadVersionContract[]> {
    const row = await this.findRow(projectId, id);
    const rows = await this.versions.list(row.id);

    return rows.map((version) => this.toVersion(version));
  }

  async getVersion(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersionContract> {
    const row = await this.findRow(projectId, id);

    return this.toVersion(await this.versions.get(row.id, versionId));
  }

  /**
   * The only read that returns variable values: those of the draft when there
   * is one, otherwise those of the active version.
   */
  async getEnv(projectId: string, id: string): Promise<WorkloadEnv> {
    const row = await this.findRow(projectId, id);

    return { env: this.effectiveEnv(row, await this.activeVersion(row)) };
  }

  async discardDraft(projectId: string, id: string): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const active = await this.activeVersion(row);

    if (active === null) {
      throw new ConflictException(ONLY_DRAFT_MESSAGE);
    }

    if (row.draft_config === null) {
      return this.toWorkload(row, active);
    }

    const [updated] = await this.db
      .update(workload)
      .set({ draft_config: null })
      .where(eq(workload.id, row.id))
      .returning();

    return this.toWorkload(updated, active);
  }

  async stop(projectId: string, id: string): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const namespace = projectNamespace(row.project_id);
    let deployment: V1Deployment | undefined;

    try {
      deployment = await this.readDeployment(row.external_name, namespace);
    } catch (error) {
      throw this.mapClusterError(error);
    }

    if (deployment === undefined || deployment.spec === undefined) {
      throw new ConflictException(NOT_DEPLOYED_MESSAGE);
    }

    deployment.spec.replicas = 0;

    try {
      await this.kubernetes.appsV1.replaceNamespacedDeployment({
        name: row.external_name,
        namespace,
        body: deployment,
      });
    } catch (error) {
      throw this.mapClusterError(error);
    }

    this.guard.noteMutation(row.id);

    return this.persistState(row.id, {
      status: 'stopped',
      status_message: null,
    });
  }

  async restart(projectId: string, id: string): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const namespace = projectNamespace(row.project_id);
    let deployment: V1Deployment | undefined;

    try {
      deployment = await this.readDeployment(row.external_name, namespace);
    } catch (error) {
      throw this.mapClusterError(error);
    }

    if (deployment === undefined || deployment.spec === undefined) {
      throw new ConflictException(NOT_DEPLOYED_MESSAGE);
    }

    // A stopped service comes back at the pod count its active version asks
    // for, not at whatever count it had before it was stopped.
    const active = await this.activeVersion(row);
    const activeConfig = active?.config as DockerWorkloadConfig | undefined;

    deployment.spec.replicas = activeConfig?.replicas ?? DEFAULT_REPLICAS;
    // Changing a pod template annotation changes the template hash, which makes
    // Kubernetes create a new ReplicaSet even when the image did not change.
    deployment.spec.template = {
      ...deployment.spec.template,
      metadata: {
        ...deployment.spec.template?.metadata,
        annotations: {
          ...deployment.spec.template?.metadata?.annotations,
          [RESTARTED_AT_ANNOTATION]: new Date().toISOString(),
        },
      },
    };

    try {
      await this.kubernetes.appsV1.replaceNamespacedDeployment({
        name: row.external_name,
        namespace,
        body: deployment,
      });
    } catch (error) {
      throw this.mapClusterError(error);
    }

    this.guard.noteMutation(row.id);

    return this.persistState(row.id, {
      status: 'deploying',
      status_message: null,
      last_deployed_at: new Date(),
    });
  }

  async remove(projectId: string, id: string): Promise<void> {
    const row = await this.findRow(projectId, id);

    await this.exclusive(row.id, () => this.removeFromCluster(row));

    this.guard.noteMutation(row.id);

    await this.db
      .delete(workload)
      .where(and(eq(workload.id, id), eq(workload.project_id, projectId)));
  }

  private async removeFromCluster(row: WorkloadRow): Promise<void> {
    const namespace = projectNamespace(row.project_id);

    try {
      // Routes first, so Traefik stops sending traffic before pods go away.
      await this.network.removeAll(row);
      await this.deleteIgnoringNotFound(() =>
        this.kubernetes.appsV1.deleteNamespacedDeployment({
          name: row.external_name,
          namespace,
        }),
      );
      // The Deployment is gone, so no ReplicaSet keeps any Secret.
      await this.pruneEnvSecrets(row);
      // The service and its data go together, even while its pods exit.
      await this.pruneVolumeClaims(row, new Set(), { force: true });
    } catch (error) {
      throw this.mapClusterError(error);
    }
  }

  /**
   * Runs cluster writes of one workload one after another. Two applies that
   * overlap could otherwise delete each other's new claims. The queue lives
   * in this process, which is the only API instance a cluster has.
   */
  private exclusive<T>(workloadId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workloadId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    const tail = next.catch(() => undefined);

    this.queues.set(workloadId, tail);
    void tail.then(() => {
      if (this.queues.get(workloadId) === tail) {
        this.queues.delete(workloadId);
      }
    });

    return next;
  }

  /**
   * The private name answers as soon as the first pod is ready. A name held
   * by an object this workload does not own must not block the deploy: the
   * service runs, only its private name is missing until it is renamed.
   */
  private async ensurePrivateName(row: WorkloadRow): Promise<void> {
    const named = await this.network.assignInternalHostname(row);

    try {
      await this.network.ensureInternalService(named);
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }

      this.logger.warn(
        `Private hostname ${named.internal_hostname} of workload ${row.id} is held by another Service; deploying without it`,
      );
    }
  }

  private async applyNow(row: WorkloadRow, plan: ApplyPlan): Promise<Workload> {
    await this.isolation.ensure(row.project_id);

    const input: WorkloadManifestInput = {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      external_name: row.external_name,
      config: plan.config,
      version_id: plan.versionId,
    };

    try {
      // The Secret and the claims go first, so new pods never start against
      // a missing one.
      await this.ensureEnvSecret(input);
      await this.ensureVolumeClaims(input);
      await this.ensurePrivateName(row);
      await this.upsertDeployment(input);
    } catch (error) {
      throw this.mapClusterError(error);
    }

    this.guard.noteMutation(row.id);

    // Housekeeping: a failure here leaves a stale Secret, not a broken deploy.
    try {
      await this.pruneEnvSecrets(input, envSecretNameOf(input));
    } catch (error) {
      this.logger.warn(
        `Could not clean up env Secrets of workload ${row.id}: ${describeError(error)}`,
      );
    }

    // Claims of volumes this version dropped. A claim that pods of the
    // previous version still mount stays until the rollout replaced them, so
    // a failed rollout keeps the old pods and their data working.
    const keep = new Set(
      (plan.config.volumes ?? []).map((volume) => volume.id!),
    );

    try {
      const pending = await this.pruneVolumeClaims(input, keep);

      if (pending > 0) {
        this.scheduleVolumePrune(input, plan.versionId, keep, 1);
      }
    } catch (error) {
      this.logger.warn(
        `Could not clean up volumes of workload ${row.id}: ${describeError(error)}`,
      );
    }

    // The cluster accepted the config; only now does it become history.
    if (plan.newVersion) {
      await this.versions.record({
        id: plan.versionId,
        workloadId: row.id,
        config: plan.config,
        sourceVersionId: plan.sourceVersionId,
        author: plan.author,
        appliedDraft: plan.appliedDraft,
      });
    } else if (plan.appliedDraft !== undefined) {
      await this.versions.clearAppliedDraft(row.id, plan.appliedDraft);
    }

    return this.persistState(row.id, {
      status: 'deploying',
      status_message: null,
      last_deployed_at: new Date(),
    });
  }

  /**
   * Creates the Secret of the applied version. A version's variables never
   * change, so a Secret that already exists (a redeploy or start of the same
   * version) is already right.
   */
  private async ensureEnvSecret(input: WorkloadManifestInput): Promise<void> {
    if (!input.config.env?.length) {
      return;
    }

    try {
      await this.kubernetes.coreV1.createNamespacedSecret({
        namespace: projectNamespace(input.project_id),
        body: buildEnvSecret(input),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }
    }
  }

  /**
   * Gives new volumes their ids and holds known ones to what they were
   * created with: only the mount path of a volume can change. `known` are the
   * volumes of the active version and the current draft. Storage profiles of
   * new volumes must exist.
   */
  private async reconcileVolumes(
    config: DockerWorkloadConfig,
    known: DockerWorkloadVolume[],
  ): Promise<void> {
    if (!config.volumes?.length) {
      return;
    }

    const byId = new Map(known.map((volume) => [volume.id, volume]));
    const profiles = new Set<string | null>();

    config.volumes = config.volumes.map((volume) => {
      if (volume.id === undefined) {
        profiles.add(volume.storage_class_id);

        return { id: randomUUID(), ...volume };
      }

      const stored = byId.get(volume.id);

      if (stored === undefined) {
        throw new BadRequestException(UNKNOWN_VOLUME_MESSAGE);
      }

      if (
        stored.size_gb !== volume.size_gb ||
        stored.storage_class_id !== volume.storage_class_id
      ) {
        throw new BadRequestException(VOLUME_FIXED_MESSAGE);
      }

      return volume;
    });

    for (const id of profiles) {
      await this.storageClasses.assertVolumeProfile(id);
    }
  }

  /**
   * Creates the claim of every volume of the applied config. A volume's size
   * and storage class never change, so a claim that already exists is right.
   */
  private async ensureVolumeClaims(
    input: WorkloadManifestInput,
  ): Promise<void> {
    const namespace = projectNamespace(input.project_id);
    const classNames = new Map<string | null, string>();

    for (const volume of input.config.volumes ?? []) {
      let className = classNames.get(volume.storage_class_id);

      if (className === undefined) {
        try {
          className = await this.storageClasses.kubernetesName(
            volume.storage_class_id,
          );
        } catch (error) {
          if (error instanceof NotFoundException) {
            throw new ConflictException(
              `The storage profile of the volume at ${volume.mount_path} no longer exists`,
            );
          }

          throw error;
        }

        classNames.set(volume.storage_class_id, className);
      }

      const body = buildVolumeClaim(input, volume, className);

      try {
        await this.kubernetes.coreV1.createNamespacedPersistentVolumeClaim({
          namespace,
          body,
        });
      } catch (error) {
        if (getKubernetesStatusCode(error) !== 409) {
          throw error;
        }

        await this.checkExistingClaim(body.metadata!.name!, namespace, volume);
      }
    }
  }

  /**
   * A claim that already exists is right only when it is this volume's and
   * it is not on its way out: pods cannot mount a claim being deleted, so
   * reusing one would leave them pending.
   */
  private async checkExistingClaim(
    name: string,
    namespace: string,
    volume: DockerWorkloadVolume,
  ): Promise<void> {
    const claim =
      await this.kubernetes.coreV1.readNamespacedPersistentVolumeClaim({
        name,
        namespace,
      });

    if (claim.metadata?.deletionTimestamp) {
      throw new ConflictException(
        `The volume at ${volume.mount_path} is still being deleted. Deploy again once it is gone.`,
      );
    }

    if (claim.metadata?.labels?.[VOLUME_ID_LABEL] !== volume.id) {
      throw new ConflictException(
        `A volume claim named ${name} already exists and belongs to something else`,
      );
    }
  }

  /**
   * Deletes the claims of this service whose volume is not in `keep`. Unless
   * `force` is set, a claim that a ReplicaSet with pods still mounts stays;
   * the count of those is returned so the caller can try again later.
   */
  private async pruneVolumeClaims(
    row: Pick<WorkloadManifestInput, 'id' | 'project_id'>,
    keep: Set<string>,
    { force = false }: { force?: boolean } = {},
  ): Promise<number> {
    const namespace = projectNamespace(row.project_id);
    const labelSelector = `${WORKLOAD_ID_LABEL}=${row.id}`;
    const [claims, replicaSets] = await Promise.all([
      this.kubernetes.coreV1.listNamespacedPersistentVolumeClaim({
        namespace,
        labelSelector,
      }),
      force
        ? Promise.resolve({ items: [] })
        : this.kubernetes.appsV1.listNamespacedReplicaSet({
            namespace,
            labelSelector,
          }),
    ]);
    const inUse = new Set<string>();

    for (const replicaSet of replicaSets.items) {
      if (
        (replicaSet.spec?.replicas ?? 0) === 0 &&
        (replicaSet.status?.replicas ?? 0) === 0
      ) {
        continue;
      }

      for (const volume of replicaSet.spec?.template?.spec?.volumes ?? []) {
        if (volume.persistentVolumeClaim?.claimName) {
          inUse.add(volume.persistentVolumeClaim.claimName);
        }
      }
    }

    let pending = 0;

    for (const claim of claims.items) {
      const name = claim.metadata?.name;
      const volumeId = claim.metadata?.labels?.[VOLUME_ID_LABEL];

      if (name === undefined || volumeId === undefined || keep.has(volumeId)) {
        continue;
      }

      if (inUse.has(name)) {
        pending += 1;
        continue;
      }

      await this.deleteIgnoringNotFound(() =>
        this.kubernetes.coreV1.deleteNamespacedPersistentVolumeClaim({
          name,
          namespace,
        }),
      );
    }

    return pending;
  }

  /**
   * Tries the prune again while the rollout replaces the pods that still
   * mount a dropped volume. It stops once nothing is pending, when another
   * version became active (that apply prunes for itself) or after the
   * rollout deadline; an API restart leaves the rest for the next apply.
   */
  private scheduleVolumePrune(
    input: WorkloadManifestInput,
    versionId: string,
    keep: Set<string>,
    attempt: number,
  ): void {
    const timer = setTimeout(() => {
      void this.exclusive(input.id, async () => {
        const [row] = await this.db
          .select({ active_version_id: workload.active_version_id })
          .from(workload)
          .where(eq(workload.id, input.id))
          .limit(1);

        if (row?.active_version_id !== versionId) {
          return 0;
        }

        return this.pruneVolumeClaims(input, keep);
      })
        .then((pending) => {
          if (pending > 0 && attempt < VOLUME_PRUNE_MAX_ATTEMPTS) {
            this.scheduleVolumePrune(input, versionId, keep, attempt + 1);
          }
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not clean up volumes of workload ${input.id}: ${describeError(error)}`,
          );
        });
    }, VOLUME_PRUNE_RETRY_MS);

    timer.unref?.();
  }

  /**
   * Deletes env Secrets that no running pod can still need: those of other
   * versions whose ReplicaSet has scaled to zero. Pods of the previous version
   * keep theirs until the rollout replaces them; what is left then goes on the
   * next deploy or with the service. `keep` is the applied version's Secret.
   */
  private async pruneEnvSecrets(
    row: Pick<WorkloadManifestInput, 'id' | 'project_id' | 'external_name'>,
    keep?: string,
  ): Promise<void> {
    const namespace = projectNamespace(row.project_id);
    const labelSelector = `${WORKLOAD_ID_LABEL}=${row.id}`;
    const prefix = envSecretPrefix(row.external_name);
    const [secrets, replicaSets] = await Promise.all([
      this.kubernetes.coreV1.listNamespacedSecret({ namespace, labelSelector }),
      this.kubernetes.appsV1.listNamespacedReplicaSet({
        namespace,
        labelSelector,
      }),
    ]);
    const inUse = new Set<string>(keep === undefined ? [] : [keep]);

    for (const replicaSet of replicaSets.items) {
      if (
        (replicaSet.spec?.replicas ?? 0) === 0 &&
        (replicaSet.status?.replicas ?? 0) === 0
      ) {
        continue;
      }

      for (const container of replicaSet.spec?.template?.spec?.containers ??
        []) {
        for (const source of container.envFrom ?? []) {
          if (source.secretRef?.name) {
            inUse.add(source.secretRef.name);
          }
        }
      }
    }

    for (const secret of secrets.items) {
      const name = secret.metadata?.name;

      if (name === undefined || !name.startsWith(prefix) || inUse.has(name)) {
        continue;
      }

      await this.deleteIgnoringNotFound(() =>
        this.kubernetes.coreV1.deleteNamespacedSecret({ name, namespace }),
      );
    }
  }

  private async upsertDeployment(row: WorkloadManifestInput): Promise<void> {
    const namespace = projectNamespace(row.project_id);
    const existing = await this.readDeployment(row.external_name, namespace);

    if (existing !== undefined) {
      await this.replaceDeployment(row, existing.metadata?.resourceVersion);

      return;
    }

    try {
      await this.kubernetes.appsV1.createNamespacedDeployment({
        namespace,
        body: buildDeployment(row),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }

      // The Deployment appeared between the read and the create. One retry
      // through the replace path reconciles it.
      const current = await this.readDeployment(row.external_name, namespace);

      if (current === undefined) {
        throw error;
      }

      await this.replaceDeployment(row, current.metadata?.resourceVersion);
    }
  }

  private async replaceDeployment(
    row: WorkloadManifestInput,
    resourceVersion: string | undefined,
  ): Promise<void> {
    if (resourceVersion === undefined) {
      throw new ConflictException('Cluster resource has no resource version');
    }

    const namespace = projectNamespace(row.project_id);
    const replace = (version: string) =>
      this.kubernetes.appsV1.replaceNamespacedDeployment({
        name: row.external_name,
        namespace,
        body: buildDeployment(row, { resourceVersion: version }),
      });

    try {
      await replace(resourceVersion);
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }

      const current = await this.readDeployment(row.external_name, namespace);
      const currentVersion = current?.metadata?.resourceVersion;

      if (currentVersion === undefined) {
        throw error;
      }

      await replace(currentVersion);
    }
  }

  private async readDeployment(
    name: string,
    namespace: string,
  ): Promise<V1Deployment | undefined> {
    try {
      return await this.kubernetes.appsV1.readNamespacedDeployment({
        name,
        namespace,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return undefined;
      }

      throw error;
    }
  }

  private async deleteIgnoringNotFound(
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }
    }
  }

  private async persistState(
    id: string,
    state: WorkloadState,
  ): Promise<Workload> {
    const [row] = await this.db
      .update(workload)
      .set(state)
      .where(eq(workload.id, id))
      .returning();

    if (!row) {
      throw new NotFoundException('Workload not found');
    }

    const workloadState = await this.present(row);

    this.events.publish({
      type: 'status',
      workload_id: row.id,
      project_id: row.project_id,
      status: row.status,
      status_message: row.status_message,
      status_observed_at: row.status_observed_at?.toISOString() ?? null,
      updated_at: row.updated_at.toISOString(),
    });

    return workloadState;
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

  /** The volumes a service is heading to: the draft's, else the active ones. */
  private effectiveVolumes(
    row: WorkloadRow,
    active: WorkloadVersionRow | null,
  ): DockerWorkloadVolume[] {
    const config = (row.draft_config ??
      active?.config ??
      null) as DockerWorkloadConfig | null;

    return config?.volumes ?? [];
  }

  private effectiveEnv(
    row: WorkloadRow,
    active: WorkloadVersionRow | null,
  ): EnvVar[] {
    const config = (row.draft_config ??
      active?.config ??
      null) as DockerWorkloadConfig | null;

    return config?.env ?? [];
  }

  private toVersion(row: WorkloadVersionRow): WorkloadVersionContract {
    const version = toWorkloadVersion(row);

    return { ...version, config: redactDockerConfig(version.config) };
  }

  private async present(row: WorkloadRow): Promise<Workload> {
    return this.toWorkload(row, await this.activeVersion(row));
  }

  private toWorkload(
    row: WorkloadRow,
    active: WorkloadVersionRow | null,
  ): Workload {
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      type: row.type,
      active_version: active === null ? null : this.toVersion(active),
      draft_config:
        row.draft_config === null ? null : redactDockerConfig(row.draft_config),
      position: row.position,
      status: row.status,
      status_message: row.status_message,
      status_observed_at: row.status_observed_at?.toISOString() ?? null,
      external_name: row.external_name,
      namespace: projectNamespace(row.project_id),
      internal_hostname: row.internal_hostname,
      internal_domain:
        row.internal_hostname === null
          ? null
          : internalDomain(row.internal_hostname),
      last_deployed_at: row.last_deployed_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
