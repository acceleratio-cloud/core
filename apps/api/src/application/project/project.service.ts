import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CreateProjectPayload,
  Project,
  UpdateProjectPayload,
} from '@acceleratio/shared';
import { desc, eq } from 'drizzle-orm';
import { normalizeName } from '@/common/validation';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { ProjectIsolationService } from './project-isolation.service';
import { project, type ProjectRow } from './schemas/project.schema';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly isolation: ProjectIsolationService,
  ) {}

  async list(): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(project)
      .orderBy(desc(project.created_at));

    return rows.map((row) => this.toProject(row));
  }

  async get(id: string): Promise<Project> {
    const [row] = await this.db
      .select()
      .from(project)
      .where(eq(project.id, id))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Project not found');
    }

    return this.toProject(row);
  }

  async exists(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, id))
      .limit(1);

    return row !== undefined;
  }

  async create(payload: CreateProjectPayload): Promise<Project> {
    const [row] = await this.db
      .insert(project)
      .values({ name: normalizeName(payload?.name) })
      .returning();

    try {
      await this.isolation.ensure(row.id);
    } catch (error) {
      await this.deleteRowAfterFailedCreate(row.id);
      throw error;
    }

    return this.toProject(row);
  }

  async update(id: string, payload: UpdateProjectPayload): Promise<Project> {
    if (payload?.name === undefined) {
      return this.get(id);
    }

    const [row] = await this.db
      .update(project)
      .set({ name: normalizeName(payload.name) })
      .where(eq(project.id, id))
      .returning();

    if (!row) {
      throw new NotFoundException('Project not found');
    }

    return this.toProject(row);
  }

  async remove(id: string): Promise<void> {
    // The namespace goes first: a project row without a namespace can be
    // deleted again, a namespace without a project row cannot be found later.
    try {
      await this.isolation.remove(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Failed to remove namespace for project ${id}: ${message}`,
      );
      throw new ServiceUnavailableException(
        'Failed to remove project namespace',
      );
    }

    const [row] = await this.db
      .delete(project)
      .where(eq(project.id, id))
      .returning({ id: project.id });

    if (!row) {
      throw new NotFoundException('Project not found');
    }
  }

  /**
   * Best-effort cleanup after a failed namespace setup. The original error is
   * the one that reaches the client, so a cleanup failure is only logged.
   */
  private async deleteRowAfterFailedCreate(id: string): Promise<void> {
    try {
      await this.db.delete(project).where(eq(project.id, id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to roll back project ${id}: ${message}`);
    }
  }

  private toProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
