import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateProjectPayload,
  Project,
  UpdateProjectPayload,
} from '@acceleratio/shared';
import { desc, eq } from 'drizzle-orm';
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

  async create(payload: CreateProjectPayload): Promise<Project> {
    const [row] = await this.db
      .insert(project)
      .values({ name: this.normalizeName(payload?.name) })
      .returning();

    return this.toProject(row);
  }

  async update(id: string, payload: UpdateProjectPayload): Promise<Project> {
    if (payload?.name === undefined) {
      return this.get(id);
    }

    const [row] = await this.db
      .update(project)
      .set({ name: this.normalizeName(payload.name) })
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

  private normalizeName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('Name is required');
    }

    return name.trim();
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
