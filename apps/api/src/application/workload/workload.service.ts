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
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { workload, type WorkloadRow } from './schemas/workload.schema';

const NAME_MAX_LENGTH = 255;
const DEFAULT_POSITION: WorkloadPosition = { x: 0, y: 0 };

@Injectable()
export class WorkloadService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectService: ProjectService,
  ) {}

  async list(projectId: string): Promise<Workload[]> {
    await this.projectService.get(projectId);

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
    await this.projectService.get(projectId);

    const type = this.normalizeType(payload?.type);

    const [row] = await this.db
      .insert(workload)
      .values({
        projectId,
        name: this.normalizeName(payload?.name),
        type,
        config: this.normalizeConfig(type, payload?.config),
        position: DEFAULT_POSITION,
      })
      .returning();

    return this.toWorkload(row);
  }

  async get(projectId: string, id: string): Promise<Workload> {
    await this.projectService.get(projectId);

    return this.toWorkload(await this.findRow(projectId, id));
  }

  async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    await this.projectService.get(projectId);

    const existing = await this.findRow(projectId, id);
    const updates: {
      name?: string;
      config?: WorkloadConfig;
      position?: WorkloadPosition;
    } = {};

    if (payload?.name !== undefined) {
      updates.name = this.normalizeName(payload.name);
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
    await this.projectService.get(projectId);

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

  private normalizeName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('Name is required');
    }

    const trimmed = name.trim();

    if (trimmed.length > NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `Keep the name under ${NAME_MAX_LENGTH} characters`,
      );
    }

    return trimmed;
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
