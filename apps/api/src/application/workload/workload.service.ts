import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateWorkloadPayload,
  S3BucketCredentials,
  UpdateInternalHostnamePayload,
  UpdateWorkloadIconPayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadBuild,
  WorkloadBuildLog,
  WorkloadEnv,
  WorkloadVersion,
  WorkloadVersionDiff,
} from '@acceleratio/shared';
import { and, eq } from 'drizzle-orm';
import { ProjectService } from '@/application/project/project.service';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { DockerWorkloadService } from './docker/docker-workload.service';
import { GithubWorkloadService } from './github/github-workload.service';
import { WorkloadEventsService } from './observer/workload-events.service';
import { S3BucketWorkloadService } from './s3-bucket/s3-bucket.service';
import { workload } from './schemas/workload.schema';
import { normalizeWorkloadIcon } from './workload-icon';
import type { WorkloadTypeService } from './workload-type-service';
import type { VersionAuthorInput } from './workload-version.service';
import { WorkloadTypeRegistry } from './workload-type.registry';
import { WorkloadTypeResolver } from './workload-type.resolver';

/**
 * Stable order: oldest first, id breaks ties so equal timestamps keep the same
 * order across requests and across type services.
 */
const compareWorkloads = (left: Workload, right: Workload): number =>
  left.created_at.localeCompare(right.created_at) ||
  left.id.localeCompare(right.id);

/**
 * Thin dispatcher over the type services. It makes no Kubernetes calls and
 * owns no table access beyond the icon, which every type shares: create
 * confirms the project and selects by the payload type, every other
 * operation resolves the type of the existing row first, then delegates.
 */
@Injectable()
export class WorkloadService {
  private readonly logger = new Logger(WorkloadService.name);

  constructor(
    private readonly registry: WorkloadTypeRegistry,
    private readonly resolver: WorkloadTypeResolver,
    private readonly projectService: ProjectService,
    private readonly s3Buckets: S3BucketWorkloadService,
    @Inject(DATABASE) private readonly db: Database,
    private readonly events: WorkloadEventsService,
  ) {}

  /**
   * Console icon of any workload type. Writes only the `icon` column, so it
   * never creates a draft, a version or a rollout.
   */
  async updateIcon(
    projectId: string,
    id: string,
    payload: UpdateWorkloadIconPayload,
  ): Promise<Workload> {
    const icon = normalizeWorkloadIcon(payload?.icon);
    const [row] = await this.db
      .update(workload)
      .set({ icon })
      .where(and(eq(workload.id, id), eq(workload.project_id, projectId)))
      .returning({ id: workload.id });

    if (!row) {
      throw new NotFoundException('Workload not found');
    }

    const updated = await this.get(projectId, id);

    // Other consoles on the project canvas pick the icon up without a reload.
    this.events.publish({
      type: 'icon',
      workload_id: updated.id,
      project_id: updated.project_id,
      icon: updated.icon,
      updated_at: updated.updated_at,
    });

    return updated;
  }

  /** Environment variables of a Docker service, values included. */
  async env(projectId: string, id: string): Promise<WorkloadEnv> {
    const service = this.registry.get(
      await this.resolver.resolve(projectId, id),
    );

    if (!(service instanceof DockerWorkloadService)) {
      throw new BadRequestException(
        'Only Docker services have environment variables',
      );
    }

    return service.getEnv(projectId, id);
  }

  /** Recent builds of a GitHub service, newest first. */
  async builds(projectId: string, id: string): Promise<WorkloadBuild[]> {
    return (await this.github(projectId, id)).listBuilds(projectId, id);
  }

  async buildLog(
    projectId: string,
    id: string,
    buildId: string,
  ): Promise<WorkloadBuildLog> {
    return (await this.github(projectId, id)).buildLog(projectId, id, buildId);
  }

  async cancelBuild(
    projectId: string,
    id: string,
    buildId: string,
  ): Promise<WorkloadBuild> {
    return (await this.github(projectId, id)).cancelBuild(
      projectId,
      id,
      buildId,
    );
  }

  private async github(
    projectId: string,
    id: string,
  ): Promise<GithubWorkloadService> {
    const service = this.registry.get(
      await this.resolver.resolve(projectId, id),
    );

    if (!(service instanceof GithubWorkloadService)) {
      throw new BadRequestException('Only GitHub services have builds');
    }

    return service;
  }

  /** Renames the private `<hostname>.internal` name of a Docker service. */
  async updateInternalHostname(
    projectId: string,
    id: string,
    payload: UpdateInternalHostnamePayload,
  ): Promise<Workload> {
    const service = this.registry.get(
      await this.resolver.resolve(projectId, id),
    );

    if (!(service instanceof DockerWorkloadService)) {
      throw new BadRequestException(
        'Only Docker services have a private hostname',
      );
    }

    return service.updateInternalHostname(projectId, id, payload);
  }

  /** Endpoint and keys of an S3 bucket, including the secret key. */
  async credentials(
    projectId: string,
    id: string,
  ): Promise<S3BucketCredentials> {
    const type = await this.resolver.resolve(projectId, id);

    if (type !== this.s3Buckets.type) {
      throw new BadRequestException('Only S3 buckets have credentials');
    }

    return this.s3Buckets.credentials(projectId, id);
  }

  /** New keys for an S3 bucket; the old ones stop working. */
  async rotateCredentials(
    projectId: string,
    id: string,
  ): Promise<S3BucketCredentials> {
    const type = await this.resolver.resolve(projectId, id);

    if (type !== this.s3Buckets.type) {
      throw new BadRequestException('Only S3 buckets have credentials');
    }

    return this.s3Buckets.rotateCredentials(projectId, id);
  }

  async list(projectId: string): Promise<Workload[]> {
    const lists = await Promise.all(
      this.registry.all().map((service) => service.list(projectId)),
    );

    return lists.flat().sort(compareWorkloads);
  }

  async create(
    projectId: string,
    payload: CreateWorkloadPayload,
  ): Promise<Workload> {
    // Keep the original error order: a missing project is a 404 even when the
    // payload also carries an unsupported type. The type service repeats this
    // check on its own path.
    if (!(await this.projectService.exists(projectId))) {
      throw new NotFoundException('Project not found');
    }

    return this.registry.get(payload?.type).create(projectId, payload);
  }

  async get(projectId: string, id: string): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.get(projectId, id);
  }

  async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.update(projectId, id, payload);
  }

  async deploy(
    projectId: string,
    id: string,
    author?: VersionAuthorInput | null,
  ): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.deploy(projectId, id, author);
  }

  async start(projectId: string, id: string): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.start(projectId, id);
  }

  async stop(projectId: string, id: string): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.stop(projectId, id);
  }

  async restart(projectId: string, id: string): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.restart(projectId, id);
  }

  async remove(projectId: string, id: string): Promise<void> {
    const service = await this.serviceForRow(projectId, id);

    return service.remove(projectId, id);
  }

  /**
   * Deletes a project with its services. Each service is removed by its type
   * first, all at once, so what lives outside the namespace (an S3 bucket, a
   * static site's volume and files) goes with it. A service that cannot be
   * removed does not keep the project: deleting the namespace takes what is
   * inside it, and only that service's outside storage is left, as logged.
   */
  async removeProject(projectId: string): Promise<void> {
    const items = await this.resolver.listInProject(projectId);
    const results = await Promise.allSettled(
      items.map(({ id, type }) =>
        this.registry.get(type).remove(projectId, id),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Could not remove workload ${items[index].id} of deleted project ${projectId}; its storage outside the namespace may remain: ${(result.reason as Error)?.message ?? String(result.reason)}`,
        );
      }
    });

    await this.projectService.remove(projectId);
  }

  async rollback(
    projectId: string,
    id: string,
    versionId: string,
    author?: VersionAuthorInput | null,
  ): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.rollback(projectId, id, versionId, author);
  }

  async diffVersions(
    projectId: string,
    id: string,
    base: string,
    target: string,
  ): Promise<WorkloadVersionDiff> {
    const service = await this.serviceForRow(projectId, id);

    return service.diffVersions(projectId, id, base, target);
  }

  async previewRollback(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersionDiff> {
    const service = await this.serviceForRow(projectId, id);

    return service.previewRollback(projectId, id, versionId);
  }

  async listVersions(
    projectId: string,
    id: string,
  ): Promise<WorkloadVersion[]> {
    const service = await this.serviceForRow(projectId, id);

    return service.listVersions(projectId, id);
  }

  async getVersion(
    projectId: string,
    id: string,
    versionId: string,
  ): Promise<WorkloadVersion> {
    const service = await this.serviceForRow(projectId, id);

    return service.getVersion(projectId, id, versionId);
  }

  async discardDraft(projectId: string, id: string): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.discardDraft(projectId, id);
  }

  private async serviceForRow(
    projectId: string,
    id: string,
  ): Promise<WorkloadTypeService> {
    const type = await this.resolver.resolve(projectId, id);

    return this.registry.get(type);
  }
}
