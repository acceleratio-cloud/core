import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  CreateWorkloadPayload,
  PostgresConfig,
  UpdateWorkloadPayload,
  Workload,
  WorkloadVersion as WorkloadVersionContract,
  WorkloadVersionDiff,
} from '@acceleratio/shared';
import { and, asc, eq } from 'drizzle-orm';
import {
  CILIUM_GROUP,
  CILIUM_POLICY_PLURAL,
  CILIUM_VERSION,
} from '@/application/project/cilium';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import { StorageClassService } from '@/application/storage-class/storage-class.service';
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
import { formatCpu, formatMemory } from '../docker/docker-workload.diff';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  WORKLOAD_ID_LABEL,
} from '../docker/docker-workload.manifests';
import { WorkloadEventsService } from '../observer/workload-events.service';
import { workload, type WorkloadRow } from '../schemas/workload.schema';
import type { WorkloadVersionRow } from '../schemas/workload-version.schema';
import {
  nextWorkloadPosition,
  normalizeWorkloadPosition,
} from '../workload-position';
import type { WorkloadTypeService } from '../workload-type-service';
import { buildDiff, changesOf, compareField } from '../workload-version.diff';
import {
  toWorkloadVersion,
  WorkloadVersionService,
} from '../workload-version.service';
import {
  normalizePostgresConfig,
  updatePostgresConfig,
} from './postgres.config';
import {
  buildCluster,
  buildClusterPolicy,
  buildCredentialsSecret,
  clusterPolicyName,
  clusterStatus,
  CNPG_CLUSTER_PLURAL,
  CNPG_GROUP,
  CNPG_VERSION,
  type CnpgCluster,
  credentialsSecretName,
  DEFAULT_CNPG_NAMESPACE,
  externalServiceName,
  DEFAULT_POSTGRES_IMAGE_REPOSITORY,
  HIBERNATION_ANNOTATION,
  POSTGRES_DATABASE,
  POSTGRES_PORT,
  POSTGRES_USERNAME,
  readWriteHost,
  RESTART_ANNOTATION,
} from './postgres.manifests';

export const UNSUPPORTED_ACTION_MESSAGE = 'Not supported for PostgreSQL';
export const EXPANSION_DISABLED_MESSAGE =
  'The storage profile of this database does not allow growing its disk';
const NAME_TAKEN_MESSAGE = 'Workload name is already used in this project';
const UNIQUE_VIOLATION = '23505';
const POLL_INTERVAL_MS = 3000;
/** First start pulls the image and runs initdb on a fresh volume. */
const GIVE_UP_AFTER_MS = 15 * 60 * 1000;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isUniqueViolation = (error: unknown): boolean => {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
};

/** `JSON Patch` path segment: `/` and `~` are escaped. */
const pointer = (key: string): string =>
  key.replace(/~/g, '~0').replace(/\//g, '~1');

const configOf = (version: WorkloadVersionRow | null): PostgresConfig | null =>
  (version?.config as PostgresConfig | undefined) ?? null;

/**
 * Single-instance PostgreSQL run by CloudNativePG: one `Cluster` per
 * workload. The database has no Deployment, so the workload observer never
 * sees it: its status is read from the Cluster. The password lives only in
 * the credentials Secret, never in the database or a response.
 */
@Injectable()
export class PostgresWorkloadService
  implements WorkloadTypeService, OnModuleInit, OnModuleDestroy
{
  readonly type = 'postgres' as const;

  private readonly logger = new Logger(PostgresWorkloadService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectService: ProjectService,
    private readonly isolation: ProjectIsolationService,
    private readonly kubernetes: KubernetesService,
    private readonly events: WorkloadEventsService,
    private readonly versions: WorkloadVersionService,
    private readonly storageClasses: StorageClassService,
  ) {}

  /** Databases that were starting when the API stopped are followed again. */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.db
        .select()
        .from(workload)
        .where(eq(workload.type, this.type));

      for (const projectId of new Set(rows.map((row) => row.project_id))) {
        const clusters = await this.listClusters(projectId);

        for (const row of rows.filter(
          (item) => item.project_id === projectId,
        )) {
          if (
            clusterStatus(clusters.get(row.id) ?? null).status === 'deploying'
          ) {
            this.follow(row, Date.now());
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Could not resume PostgreSQL status polling: ${describeError(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  private get operatorNamespace(): string {
    return process.env.CNPG_NAMESPACE?.trim() || DEFAULT_CNPG_NAMESPACE;
  }

  private get podCidr(): string | undefined {
    return process.env.K3S_CLUSTER_CIDR?.trim() || undefined;
  }

  private get imageRepository(): string {
    return (
      process.env.POSTGRES_IMAGE_REPOSITORY?.trim() ||
      DEFAULT_POSTGRES_IMAGE_REPOSITORY
    );
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

    const [active, clusters] = await Promise.all([
      this.versions.findByIds(
        rows.flatMap((row) =>
          row.active_version_id === null ? [] : [row.active_version_id],
        ),
      ),
      this.listClusters(projectId),
    ]);

    return rows.map((row) =>
      this.toWorkload(
        row,
        row.active_version_id === null
          ? null
          : (active.get(row.active_version_id) ?? null),
        clusters.get(row.id) ?? null,
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

    const name = normalizeName(payload?.name);
    const config = normalizePostgresConfig(payload?.config);
    let storageClassName: string;

    try {
      storageClassName = await this.storageClasses.kubernetesName(
        config.storage_class_id,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new BadRequestException('Storage profile not found');
      }

      throw error;
    }

    const id = randomUUID();
    const row = await this.insertRow({
      id,
      project_id: projectId,
      name,
      type: this.type,
      draft_config: null,
      position: await nextWorkloadPosition(this.db, projectId),
      external_name: workloadExternalName(name, id),
      last_deployed_at: new Date(),
    });

    try {
      await this.isolation.ensure(projectId);
      await this.createIgnoringConflict(() =>
        this.kubernetes.coreV1.createNamespacedSecret({
          namespace: projectNamespace(projectId),
          body: buildCredentialsSecret(
            row,
            randomBytes(24).toString('base64url'),
          ),
        }),
      );
      await this.createIgnoringConflict(() =>
        this.kubernetes.customObjects.createNamespacedCustomObject({
          group: CILIUM_GROUP,
          version: CILIUM_VERSION,
          namespace: projectNamespace(projectId),
          plural: CILIUM_POLICY_PLURAL,
          body: buildClusterPolicy(row, this.operatorNamespace),
        }),
      );
      await this.kubernetes.customObjects.createNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(projectId),
        plural: CNPG_CLUSTER_PLURAL,
        body: buildCluster(
          row,
          config,
          storageClassName,
          this.imageRepository,
          this.podCidr,
        ),
      });
      await this.versions.record({
        id: randomUUID(),
        workloadId: row.id,
        config,
      });
    } catch (error) {
      // Nothing holds data yet: drop what was made so the name is free again.
      await this.removeFromCluster(row).catch(() => undefined);
      await this.db.delete(workload).where(eq(workload.id, row.id));

      throw this.mapClusterError(error);
    }

    this.follow(row, Date.now());

    return this.get(projectId, row.id);
  }

  async get(projectId: string, id: string): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const [active, cluster] = await Promise.all([
      this.activeVersion(row),
      this.readCluster(row),
    ]);

    return this.toWorkload(row, active, cluster);
  }

  /**
   * Renames, moves, and changes CPU or memory. A resource change is applied
   * at once and recorded as a version; CNPG restarts the instance for it.
   */
  async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    const existing = await this.findRow(projectId, id);
    const changes: Partial<typeof workload.$inferInsert> = {};

    if (payload?.name !== undefined) {
      changes.name = normalizeName(payload.name);
    }

    if (payload?.position !== undefined) {
      changes.position = normalizeWorkloadPosition(payload.position);
    }

    if (payload?.config !== undefined) {
      const current = configOf(await this.activeVersion(existing));

      if (current === null) {
        throw new ConflictException('The database has no applied settings');
      }

      const next = updatePostgresConfig(current, payload.config);
      const resized =
        next.cpu_max !== current.cpu_max || next.ram_max !== current.ram_max;
      const grown = next.size_gb > current.size_gb;

      if (grown) {
        await this.assertExpandable(next.storage_class_id);
      }

      if (resized || grown) {
        const spec = buildCluster(existing, next, '').spec as {
          resources: unknown;
          storage: { size: string };
          postgresql: { parameters: { max_wal_size: string } };
        };

        // CNPG grows the claim in place; the WAL cap follows the new size.
        await this.patchCluster(existing, [
          ...(resized
            ? [
                {
                  op: 'replace',
                  path: '/spec/resources',
                  value: spec.resources,
                },
              ]
            : []),
          ...(grown
            ? [
                {
                  op: 'replace',
                  path: '/spec/storage/size',
                  value: spec.storage.size,
                },
                {
                  op: 'add',
                  path: '/spec/postgresql/parameters/max_wal_size',
                  value: spec.postgresql.parameters.max_wal_size,
                },
              ]
            : []),
        ]);
        await this.versions.record({
          id: randomUUID(),
          workloadId: existing.id,
          config: next,
        });
        changes.last_deployed_at = new Date();
      }
    }

    if (Object.keys(changes).length > 0) {
      const [row] = await this.db
        .update(workload)
        .set(changes)
        .where(eq(workload.id, existing.id))
        .returning();

      if (changes.position !== undefined) {
        this.events.publish({
          type: 'position',
          workload_id: row.id,
          project_id: row.project_id,
          position: row.position,
          updated_at: row.updated_at.toISOString(),
        });
      }

      if (changes.last_deployed_at !== undefined) {
        this.follow(row, Date.now());
      }
    }

    return this.get(projectId, id);
  }

  start(projectId: string, id: string): Promise<Workload> {
    return this.annotate(projectId, id, HIBERNATION_ANNOTATION, 'off');
  }

  stop(projectId: string, id: string): Promise<Workload> {
    return this.annotate(projectId, id, HIBERNATION_ANNOTATION, 'on');
  }

  restart(projectId: string, id: string): Promise<Workload> {
    return this.annotate(
      projectId,
      id,
      RESTART_ANNOTATION,
      new Date().toISOString(),
    );
  }

  /** Deletes the Cluster; Kubernetes deletes its volume and data with it. */
  async remove(projectId: string, id: string): Promise<void> {
    const row = await this.findRow(projectId, id);

    this.stopFollowing(row.id);

    try {
      await this.removeFromCluster(row);
    } catch (error) {
      throw this.mapClusterError(error);
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
    const before = left.config as PostgresConfig | null;
    const after = right.config as PostgresConfig | null;

    return buildDiff({
      workloadId: row.id,
      type: this.type,
      base: left.side,
      target: right.side,
      sections: [
        {
          key: 'resources',
          label: 'Resources',
          changes: changesOf([
            compareField({
              path: 'cpu_max',
              label: 'CPU limit',
              before: before && formatCpu(before.cpu_max),
              after: after && formatCpu(after.cpu_max),
              impact: 'restart',
            }),
            compareField({
              path: 'ram_max',
              label: 'Memory limit',
              before: before && formatMemory(before.ram_max),
              after: after && formatMemory(after.ram_max),
              impact: 'restart',
            }),
          ]),
        },
        {
          key: 'storage',
          label: 'Storage',
          changes: changesOf([
            compareField({
              path: 'size_gb',
              label: 'Disk size',
              before: before && `${before.size_gb} GiB`,
              after: after && `${after.size_gb} GiB`,
            }),
          ]),
        },
      ],
    });
  }

  previewRollback(): Promise<WorkloadVersionDiff> {
    return this.unsupported();
  }

  deploy(): Promise<Workload> {
    return this.unsupported();
  }

  rollback(): Promise<Workload> {
    return this.unsupported();
  }

  discardDraft(): Promise<Workload> {
    return this.unsupported();
  }

  /** A volume grows only on a StorageClass that allows expansion. */
  private async assertExpandable(storageClassId: string | null): Promise<void> {
    const name = await this.storageClasses.kubernetesName(storageClassId);
    const storageClass = await this.kubernetes.storageV1
      .readStorageClass({ name })
      .catch((error: unknown) => {
        throw this.mapClusterError(error);
      });

    if (storageClass.allowVolumeExpansion !== true) {
      throw new BadRequestException(EXPANSION_DISABLED_MESSAGE);
    }
  }

  /** The workload row of a database, for the overview. */
  findDatabase(projectId: string, id: string): Promise<WorkloadRow> {
    return this.findRow(projectId, id);
  }

  private unsupported(): Promise<never> {
    return Promise.reject(new BadRequestException(UNSUPPORTED_ACTION_MESSAGE));
  }

  private async insertRow(
    values: typeof workload.$inferInsert,
  ): Promise<WorkloadRow> {
    for (const idPrefix of [undefined, CONFLICT_ID_PREFIX_LENGTH]) {
      try {
        const [row] = await this.db
          .insert(workload)
          .values({
            ...values,
            external_name: workloadExternalName(
              values.name,
              values.id!,
              DEFAULT_SLUG_LENGTH,
              idPrefix,
            ),
          })
          .returning();

        return row;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException(NAME_TAKEN_MESSAGE);
  }

  private async annotate(
    projectId: string,
    id: string,
    key: string,
    value: string,
  ): Promise<Workload> {
    const row = await this.findRow(projectId, id);

    // Clusters are created with annotations, so the map exists.
    await this.patchCluster(row, [
      { op: 'add', path: `/metadata/annotations/${pointer(key)}`, value },
    ]);
    this.follow(row, Date.now());

    return this.get(projectId, id);
  }

  private async patchCluster(row: WorkloadRow, body: object[]): Promise<void> {
    try {
      await this.kubernetes.customObjects.patchNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(row.project_id),
        plural: CNPG_CLUSTER_PLURAL,
        name: row.external_name,
        body,
      });
    } catch (error) {
      throw this.mapClusterError(error);
    }
  }

  private async removeFromCluster(row: WorkloadRow): Promise<void> {
    const namespace = projectNamespace(row.project_id);

    await this.ignoreNotFound(() =>
      this.kubernetes.customObjects.deleteNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace,
        plural: CNPG_CLUSTER_PLURAL,
        name: row.external_name,
      }),
    );
    await this.ignoreNotFound(() =>
      this.kubernetes.coreV1.deleteNamespacedService({
        name: externalServiceName(row.external_name),
        namespace,
      }),
    );
    await this.ignoreNotFound(() =>
      this.kubernetes.coreV1.deleteNamespacedSecret({
        name: credentialsSecretName(row.external_name),
        namespace,
      }),
    );
    await this.ignoreNotFound(() =>
      this.kubernetes.customObjects.deleteNamespacedCustomObject({
        group: CILIUM_GROUP,
        version: CILIUM_VERSION,
        namespace,
        plural: CILIUM_POLICY_PLURAL,
        name: clusterPolicyName(row.external_name),
      }),
    );
  }

  /** Polls the Cluster until it settles and publishes the status it reached. */
  private follow(row: WorkloadRow, startedAt: number): void {
    this.stopFollowing(row.id);

    const tick = async () => {
      this.timers.delete(row.id);

      try {
        const cluster = await this.readCluster(row);
        const { status, status_message } = clusterStatus(cluster);
        const settled = status !== 'deploying';

        if (settled || Date.now() - startedAt > GIVE_UP_AFTER_MS) {
          this.events.publish({
            type: 'status',
            workload_id: row.id,
            project_id: row.project_id,
            status,
            status_message,
            status_observed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          return;
        }
      } catch (error) {
        this.logger.warn(
          `Polling database ${row.id} failed: ${describeError(error)}`,
        );
      }

      this.schedule(row.id, tick);
    };

    this.schedule(row.id, tick);
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

  private async readCluster(row: WorkloadRow): Promise<CnpgCluster | null> {
    try {
      const cluster =
        (await this.kubernetes.customObjects.getNamespacedCustomObject({
          group: CNPG_GROUP,
          version: CNPG_VERSION,
          namespace: projectNamespace(row.project_id),
          plural: CNPG_CLUSTER_PLURAL,
          name: row.external_name,
        })) as CnpgCluster;

      // A Cluster of that name that this workload did not create is not its.
      return cluster.metadata.labels?.[WORKLOAD_ID_LABEL] === row.id
        ? cluster
        : null;
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        this.logger.warn(
          `Could not read database ${row.external_name}: ${describeError(error)}`,
        );
      }

      return null;
    }
  }

  /** One request per project: every database Cluster by label. */
  private async listClusters(
    projectId: string,
  ): Promise<Map<string, CnpgCluster>> {
    try {
      const { items } =
        (await this.kubernetes.customObjects.listNamespacedCustomObject({
          group: CNPG_GROUP,
          version: CNPG_VERSION,
          namespace: projectNamespace(projectId),
          plural: CNPG_CLUSTER_PLURAL,
          labelSelector: `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE},${WORKLOAD_ID_LABEL}`,
        })) as { items: CnpgCluster[] };

      return new Map(
        items.flatMap((cluster) => {
          const id = cluster.metadata.labels?.[WORKLOAD_ID_LABEL];

          return id ? [[id, cluster] as const] : [];
        }),
      );
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        this.logger.warn(
          `Could not list databases of project ${projectId}: ${describeError(error)}`,
        );
      }

      return new Map();
    }
  }

  private async createIgnoringConflict(
    run: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }
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

  private toWorkload(
    row: WorkloadRow,
    active: WorkloadVersionRow | null,
    cluster: CnpgCluster | null,
  ): Workload {
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      type: row.type,
      active_version: active === null ? null : toWorkloadVersion(active),
      draft_config: null,
      position: row.position,
      ...clusterStatus(cluster),
      status_observed_at: new Date().toISOString(),
      external_name: row.external_name,
      namespace: projectNamespace(row.project_id),
      last_deployed_at: row.last_deployed_at?.toISOString() ?? null,
      postgres: {
        host: readWriteHost(row.external_name, row.project_id),
        port: POSTGRES_PORT,
        database: POSTGRES_DATABASE,
        username: POSTGRES_USERNAME,
        secret_name: credentialsSecretName(row.external_name),
      },
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
