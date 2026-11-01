import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadConfig,
  WorkloadPosition,
  WorkloadType,
} from '@acceleratio/shared';
import { and, asc, eq } from 'drizzle-orm';
import { ProjectService } from '@/application/project/project.service';
import { normalizeName } from '@/common/validation';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { workload, type WorkloadRow } from './schemas/workload.schema';

const DEFAULT_POSITION: WorkloadPosition = { x: 0, y: 0 };

@Injectable()
export class WorkloadService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectService: ProjectService,
  ) {}

  async list(projectId: string): Promise<Workload[]> {
    const rows = await this.db
      .select()
      .from(workload)
      .where(eq(workload.projectId, projectId))
      .orderBy(asc(workload.createdAt));

    return rows.map((row) => this.toWorkload(row));
  }

  async create(
    projectId: string,
    payload: CreateWorkloadPayload,
  ): Promise<Workload> {
    // The insert relies on a foreign key, so a missing project would surface as
    // a database error instead of a 404. This is the only place that needs the
    // check; every other query already filters by projectId.
    if (!(await this.projectService.exists(projectId))) {
      throw new NotFoundException('Project not found');
    }

    const type = this.normalizeType(payload?.type);

    const [row] = await this.db
      .insert(workload)
      .values({
        projectId,
        name: normalizeName(payload?.name),
        type,
        config: this.normalizeConfig(type, payload?.config),
        position: DEFAULT_POSITION,
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
      updates.config = this.normalizeConfig(existing.type, payload.config);
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

  async remove(projectId: string, id: string): Promise<void> {
    const [row] = await this.db
      .delete(workload)
      .where(and(eq(workload.id, id), eq(workload.projectId, projectId)))
      .returning({ id: workload.id });

    if (!row) {
      throw new NotFoundException('Workload not found');
    }
  }

  private async findRow(projectId: string, id: string): Promise<WorkloadRow> {
    const [row] = await this.db
      .select()
      .from(workload)
      .where(and(eq(workload.id, id), eq(workload.projectId, projectId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Workload not found');
    }

    return row;
  }

  private normalizeType(type: unknown): WorkloadType {
    if (type !== 'docker') {
      throw new BadRequestException('Unsupported workload type');
    }

    return type;
  }

  private normalizeConfig(
    type: WorkloadType,
    config: WorkloadConfig | undefined,
  ): WorkloadConfig {
    switch (type) {
      case 'docker':
        return this.normalizeDockerConfig(config);
    }
  }

  private normalizeDockerConfig(
    config: WorkloadConfig | undefined,
  ): WorkloadConfig {
    const image = config?.docker_image;

    if (typeof image !== 'string' || !image.trim()) {
      throw new BadRequestException('docker_image is required');
    }

    return { docker_image: image.trim() };
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
      projectId: row.projectId,
      name: row.name,
      type: row.type,
      config: row.config,
      position: row.position,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
