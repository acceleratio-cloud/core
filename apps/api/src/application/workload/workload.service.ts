import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
} from '@acceleratio/shared';
import { ProjectService } from '@/application/project/project.service';
import type { WorkloadTypeService } from './workload-type-service';
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
 * Thin dispatcher over the type services. It owns no table access and no
 * Kubernetes calls: create confirms the project and selects by the payload
 * type, every other operation resolves the type of the existing row first,
 * then delegates.
 */
@Injectable()
export class WorkloadService {
  constructor(
    private readonly registry: WorkloadTypeRegistry,
    private readonly resolver: WorkloadTypeResolver,
    private readonly projectService: ProjectService,
  ) {}

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

  async deploy(projectId: string, id: string): Promise<Workload> {
    const service = await this.serviceForRow(projectId, id);

    return service.deploy(projectId, id);
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

  private async serviceForRow(
    projectId: string,
    id: string,
  ): Promise<WorkloadTypeService> {
    const type = await this.resolver.resolve(projectId, id);

    return this.registry.get(type);
  }
}
