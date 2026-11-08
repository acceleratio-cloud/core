import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateWorkloadPayload,
  GithubWorkloadConfig,
  UpdateWorkloadPayload,
  Workload,
  WorkloadVersion,
  WorkloadVersionDiff,
} from '@acceleratio/shared';
import { and, asc, eq } from 'drizzle-orm';
import { GithubService } from '@/application/integration/github/github.service';
import { ProjectService } from '@/application/project/project.service';
import { projectNamespace, workloadExternalName } from '@/common/naming';
import { normalizeName } from '@/common/validation';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { workload, type WorkloadRow } from '../schemas/workload.schema';
import {
  nextWorkloadPosition,
  normalizeWorkloadPosition,
} from '../workload-position';
import type { WorkloadTypeService } from '../workload-type-service';

const NOT_SUPPORTED_MESSAGE =
  'This action is not available for GitHub services yet';

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * GitHub services. For now a service only records which repository branch it
 * follows, as a draft: nothing is built or deployed, so every cluster action
 * is rejected and the status stays `draft`.
 */
@Injectable()
export class GithubWorkloadService implements WorkloadTypeService {
  readonly type = 'github' as const;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectService: ProjectService,
    private readonly github: GithubService,
  ) {}

  async list(projectId: string): Promise<Workload[]> {
    const rows = await this.db
      .select()
      .from(workload)
      .where(
        and(eq(workload.project_id, projectId), eq(workload.type, this.type)),
      )
      .orderBy(asc(workload.created_at));

    return rows.map((row) => this.toWorkload(row));
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

    const name = normalizeName(payload.name);
    const config = await this.resolveConfig(
      payload.config as Partial<GithubWorkloadConfig> | undefined,
    );
    const id = randomUUID();
    const [row] = await this.db
      .insert(workload)
      .values({
        id,
        project_id: projectId,
        name,
        type: this.type,
        draft_config: config,
        position: await nextWorkloadPosition(this.db, projectId),
        external_name: workloadExternalName(name, id),
      })
      .returning();

    return this.toWorkload(row);
  }

  async get(projectId: string, id: string): Promise<Workload> {
    return this.toWorkload(await this.findRow(projectId, id));
  }

  async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    await this.findRow(projectId, id);

    if (payload?.config !== undefined) {
      throw new BadRequestException(NOT_SUPPORTED_MESSAGE);
    }

    const updates: { name?: string; position?: WorkloadRow['position'] } = {};

    if (payload?.name !== undefined) {
      updates.name = normalizeName(payload.name);
    }

    if (payload?.position !== undefined) {
      updates.position = normalizeWorkloadPosition(payload.position);
    }

    if (Object.keys(updates).length === 0) {
      return this.get(projectId, id);
    }

    const [row] = await this.db
      .update(workload)
      .set(updates)
      .where(and(eq(workload.id, id), eq(workload.project_id, projectId)))
      .returning();

    return this.toWorkload(row);
  }

  async remove(projectId: string, id: string): Promise<void> {
    await this.findRow(projectId, id);
    await this.db
      .delete(workload)
      .where(and(eq(workload.id, id), eq(workload.project_id, projectId)));
  }

  async listVersions(): Promise<WorkloadVersion[]> {
    return [];
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
  getVersion(): Promise<WorkloadVersion> {
    return this.unsupported();
  }
  diffVersions(): Promise<WorkloadVersionDiff> {
    return this.unsupported();
  }
  previewRollback(): Promise<WorkloadVersionDiff> {
    return this.unsupported();
  }
  discardDraft(): Promise<Workload> {
    return this.unsupported();
  }

  /** The repository must be reachable through the chosen App's installations. */
  private async resolveConfig(
    input: Partial<GithubWorkloadConfig> | undefined,
  ): Promise<GithubWorkloadConfig> {
    const appId = text(input?.github_app_id);
    const repository = text(input?.repository);

    if (!appId || !repository) {
      throw new BadRequestException('Choose a GitHub App and a repository');
    }

    const repositories = await this.github.repositories(appId);
    const found = repositories.find((item) => item.full_name === repository);

    if (!found) {
      throw new BadRequestException(
        'The repository is not available to this GitHub App',
      );
    }

    return {
      github_app_id: appId,
      repository: found.full_name,
      branch: text(input?.branch) || found.default_branch,
    };
  }

  private unsupported(): Promise<never> {
    return Promise.reject(new BadRequestException(NOT_SUPPORTED_MESSAGE));
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

  private toWorkload(row: WorkloadRow): Workload {
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      type: row.type,
      active_version: null,
      draft_config: row.draft_config,
      position: row.position,
      status: 'draft',
      status_message: null,
      status_observed_at: null,
      external_name: row.external_name,
      namespace: projectNamespace(row.project_id),
      last_deployed_at: null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
