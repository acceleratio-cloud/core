import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { V1Deployment } from '@kubernetes/client-node';
import type {
  CreateWorkloadPayload,
  DockerWorkloadConfig,
  UpdateWorkloadPayload,
  Workload,
  WorkloadConfig,
  WorkloadPosition,
  WorkloadStatus,
} from '@acceleratio/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { WorkloadVersion as WorkloadVersionContract } from '@acceleratio/shared';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import {
  CONFLICT_ID_PREFIX_LENGTH,
  DEFAULT_SLUG_LENGTH,
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
  WorkloadVersionService,
} from '@/application/workload/workload-version.service';
import {
  newDockerConfig,
  normalizeDockerConfig,
} from './docker-workload.config';
import {
  buildDeployment,
  RESTARTED_AT_ANNOTATION,
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

/** What one apply writes to the cluster and records afterwards. */
interface ApplyPlan {
  config: DockerWorkloadConfig;
  /** Existing version to reapply, or the id for a new one. */
  versionId: string;
  /** True when the apply creates a version instead of reapplying one. */
  newVersion: boolean;
  sourceVersionId?: string | null;
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
const isExternalNameConflict = (error: unknown): boolean => {
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

    if (
      candidate.code === UNIQUE_VIOLATION &&
      (candidate.constraint === undefined ||
        candidate.constraint === EXTERNAL_NAME_CONSTRAINT)
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
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
export class DockerWorkloadService implements WorkloadTypeService {
  readonly type = 'docker' as const;

  private readonly logger = new Logger(DockerWorkloadService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectService: ProjectService,
    private readonly isolation: ProjectIsolationService,
    private readonly kubernetes: KubernetesService,
    private readonly guard: WorkloadMutationGuard,
    private readonly events: WorkloadEventsService,
    private readonly versions: WorkloadVersionService,
  ) {}

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
  async deploy(projectId: string, id: string): Promise<Workload> {
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
      return this.apply(row, {
        config: draft,
        versionId: randomUUID(),
        newVersion: true,
        appliedDraft: draft,
      });
    }

    // Either no draft, or a draft that equals the applied config (left over
    // after a rollback moved the active version under it).
    return this.apply(row, {
      config: normalizeDockerConfig(active!.config),
      versionId: active!.id,
      newVersion: false,
      ...(draft !== null ? { appliedDraft: draft } : {}),
    });
  }

  /**
   * Starting a stopped workload reapplies the active version. Pending draft
   * changes are left for an explicit deploy.
   */
  async start(projectId: string, id: string): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const active = await this.activeVersion(row);

    if (active === null) {
      throw new ConflictException(NOT_DEPLOYED_MESSAGE);
    }

    return this.apply(row, {
      config: normalizeDockerConfig(active.config),
      versionId: active.id,
      newVersion: false,
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
  ): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const target = await this.versions.get(row.id, versionId);

    if (target.id === row.active_version_id) {
      throw new ConflictException(ALREADY_ACTIVE_MESSAGE);
    }

    return this.apply(row, {
      config: normalizeDockerConfig(target.config),
      versionId: randomUUID(),
      newVersion: true,
      sourceVersionId: target.id,
    });
  }

  async listVersions(
    projectId: string,
    id: string,
  ): Promise<WorkloadVersionContract[]> {
    const row = await this.findRow(projectId, id);
    const rows = await this.versions.list(row.id);

    return rows.map(toWorkloadVersion);
  }

  async getVersion(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersionContract> {
    const row = await this.findRow(projectId, id);

    return toWorkloadVersion(await this.versions.get(row.id, versionId));
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

    deployment.spec.replicas = 1;
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
    const namespace = projectNamespace(row.project_id);

    try {
      await this.deleteIgnoringNotFound(() =>
        this.kubernetes.appsV1.deleteNamespacedDeployment({
          name: row.external_name,
          namespace,
        }),
      );
    } catch (error) {
      throw this.mapClusterError(error);
    }

    this.guard.noteMutation(row.id);

    await this.db
      .delete(workload)
      .where(and(eq(workload.id, id), eq(workload.project_id, projectId)));
  }

  private async apply(row: WorkloadRow, plan: ApplyPlan): Promise<Workload> {
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
      await this.upsertDeployment(input);
    } catch (error) {
      throw this.mapClusterError(error);
    }

    this.guard.noteMutation(row.id);

    // The cluster accepted the config; only now does it become history.
    if (plan.newVersion) {
      await this.versions.record({
        id: plan.versionId,
        workloadId: row.id,
        config: plan.config,
        sourceVersionId: plan.sourceVersionId,
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
      active_version: active === null ? null : toWorkloadVersion(active),
      draft_config: row.draft_config,
      position: row.position,
      status: row.status,
      status_message: row.status_message,
      status_observed_at: row.status_observed_at?.toISOString() ?? null,
      external_name: row.external_name,
      namespace: projectNamespace(row.project_id),
      last_deployed_at: row.last_deployed_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
