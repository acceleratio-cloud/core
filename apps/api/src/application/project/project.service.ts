import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateProjectPayload,
  Project,
  UpdateProjectPayload,
} from '@acceleratio/shared';
import { desc, eq } from 'drizzle-orm';
import { normalizeName } from '@/common/validation';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { project, type ProjectRow } from './schemas/project.schema';

@Injectable()
export class ProjectService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(project)
      .orderBy(desc(project.createdAt));

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
    const [row] = await this.db
      .delete(project)
      .where(eq(project.id, id))
      .returning({ id: project.id });

    if (!row) {
      throw new NotFoundException('Project not found');
    }
  }

  private toProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
