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
import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadConfig,
  WorkloadPosition,
  WorkloadStatus,
} from '@acceleratio/shared';
import { and, asc, eq } from 'drizzle-orm';
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
import {
  workload,
  type WorkloadRow,
} from '@/application/workload/schemas/workload.schema';
import type { WorkloadTypeService } from '@/application/workload/workload-type-service';
import { normalizeDockerConfig } from './docker-workload.config';
import {
  buildDeployment,
  RESTARTED_AT_ANNOTATION,
  WORKLOAD_ID_LABEL,
} from './docker-workload.manifests';
import { deriveStatus } from './docker-workload.status';

const DEFAULT_POSITION: WorkloadPosition = { x: 0, y: 0 };
const UNIQUE_VIOLATION = '23505';
const EXTERNAL_NAME_CONSTRAINT = 'workload_project_id_external_name_unique';
const NOT_DEPLOYED_MESSAGE = 'Workload is not deployed yet';
const UNSUPPORTED_TYPE_MESSAGE = 'Unsupported workload type';

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
 * lifecycle, status reconciliation and the mapping to the API contract.
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
  ) {}

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

    const reconciled = await this.reconcile(projectId, rows);

    return reconciled.map((row) => this.toWorkload(row));
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
    const config = normalizeDockerConfig(payload?.config);
    // The id is generated here rather than by the database so external_name can
    // be computed before the single insert statement.
    const id = randomUUID();
    const values = {
      id,
      project_id: projectId,
      name,
      type: this.type,
      config,
      position: DEFAULT_POSITION,
      external_name: workloadExternalName(name, id),
    };

    try {
      const [row] = await this.db.insert(workload).values(values).returning();

      return this.toWorkload(row);
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

      return this.toWorkload(row);
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
    return this.toWorkload(await this.findRow(projectId, id));
  }

  async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    const existing = await this.findRow(projectId, id);
    const updates: {
      name?: string;
      config?: WorkloadConfig;
      position?: WorkloadPosition;
    } = {};

    if (payload?.name !== undefined) {
      updates.name = normalizeName(payload.name);
    }

    if (payload?.config !== undefined) {
      updates.config = normalizeDockerConfig(payload.config);
    }

    if (payload?.position !== undefined) {
      updates.position = this.normalizePosition(payload.position);
    }

    if (Object.keys(updates).length === 0) {
      return this.toWorkload(existing);
    }

    const [row] = await this.db
      .update(workload)
      .set(updates)
      .where(eq(workload.id, existing.id))
      .returning();

    return this.toWorkload(row);
  }

  async deploy(projectId: string, id: string): Promise<Workload> {
    return this.apply(await this.findRow(projectId, id));
  }

  /**
   * Starting a stopped workload applies the same manifest as deploy; the only
   * difference is which buttons the console enables.
   */
  async start(projectId: string, id: string): Promise<Workload> {
    return this.deploy(projectId, id);
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

    await this.db
      .delete(workload)
      .where(and(eq(workload.id, id), eq(workload.project_id, projectId)));
  }

  private async apply(row: WorkloadRow): Promise<Workload> {
    await this.isolation.ensure(row.project_id);

    try {
      await this.upsertDeployment(row);
    } catch (error) {
      throw this.mapClusterError(error);
    }

    return this.persistState(row.id, {
      status: 'deploying',
      status_message: null,
      last_deployed_at: new Date(),
    });
  }

  private async upsertDeployment(row: WorkloadRow): Promise<void> {
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
    row: WorkloadRow,
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

    return this.toWorkload(row);
  }

  /**
   * One Deployment list and one Pod list per project. Only rows whose observed
   * status changed are written, so a polling console does not churn
   * updated_at on every request. A missing namespace or an unreachable cluster
   * falls back to the stored rows.
   */
  private async reconcile(
    projectId: string,
    rows: WorkloadRow[],
  ): Promise<WorkloadRow[]> {
    const namespace = projectNamespace(projectId);
    let deployments: V1Deployment[];
    let pods: V1Pod[];

    try {
      const [deploymentList, podList] = await Promise.all([
        this.kubernetes.appsV1.listNamespacedDeployment({ namespace }),
        this.kubernetes.coreV1.listNamespacedPod({ namespace }),
      ]);

      deployments = deploymentList.items ?? [];
      pods = podList.items ?? [];
    } catch (error) {
      this.logger.warn(
        `Skipped workload reconciliation for project ${projectId}: ${describeError(error)}`,
      );

      return rows;
    }

    const deploymentsByName = new Map<string, V1Deployment>();

    for (const deployment of deployments) {
      const name = deployment.metadata?.name;

      if (name !== undefined) {
        deploymentsByName.set(name, deployment);
      }
    }

    const podsByWorkloadId = new Map<string, V1Pod[]>();

    for (const pod of pods) {
      const workloadId = pod.metadata?.labels?.[WORKLOAD_ID_LABEL];

      if (workloadId === undefined) {
        continue;
      }

      const group = podsByWorkloadId.get(workloadId);

      if (group !== undefined) {
        group.push(pod);
      } else {
        podsByWorkloadId.set(workloadId, [pod]);
      }
    }

    const reconciled: WorkloadRow[] = [];

    for (const row of rows) {
      const deployment = deploymentsByName.get(row.external_name);
      const workloadPods = podsByWorkloadId.get(row.id) ?? [];

      // Nothing was ever deployed (or the namespace is gone): keep the stored
      // state instead of resetting a draft or an intentionally stopped row.
      if (deployment === undefined && workloadPods.length === 0) {
        reconciled.push(row);
        continue;
      }

      const derived = deriveStatus(deployment, workloadPods);

      if (
        derived.status === row.status &&
        derived.status_message === row.status_message
      ) {
        reconciled.push(row);
        continue;
      }

      const [updated] = await this.db
        .update(workload)
        .set({
          status: derived.status,
          status_message: derived.status_message,
        })
        .where(eq(workload.id, row.id))
        .returning();

      reconciled.push(
        updated ?? {
          ...row,
          status: derived.status,
          status_message: derived.status_message,
        },
      );
    }

    return reconciled;
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

  private normalizePosition(position: unknown): WorkloadPosition {
    const candidate = position as Partial<WorkloadPosition> | null | undefined;
    const x = candidate?.x;
    const y = candidate?.y;

    if (
      typeof x !== 'number' ||
      !Number.isFinite(x) ||
      typeof y !== 'number' ||
      !Number.isFinite(y)
    ) {
      throw new BadRequestException('position must contain numeric x and y');
    }

    return { x, y };
  }

  private toWorkload(row: WorkloadRow): Workload {
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      type: row.type,
      // Legacy rows may still carry a port in JSONB; the contract no longer
      // exposes one.
      config: { docker_image: row.config.docker_image },
      position: row.position,
      status: row.status,
      status_message: row.status_message,
      external_name: row.external_name,
      namespace: projectNamespace(row.project_id),
      last_deployed_at: row.last_deployed_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
