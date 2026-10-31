import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
} from '@acceleratio/shared';
import { WorkloadService } from './workload.service';

@Controller('projects/:projectId/workloads')
export class WorkloadController {
  constructor(private readonly workloadService: WorkloadService) {}

  @Get()
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Workload[]> {
    return this.workloadService.list(projectId);
  }

  @Get(':id')
  get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.get(projectId, id);
  }

  @Post()
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateWorkloadPayload,
  ): Promise<Workload> {
    return this.workloadService.create(projectId, body);
  }

  @Patch(':id')
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkloadPayload,
  ): Promise<Workload> {
    return this.workloadService.update(projectId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.workloadService.remove(projectId, id);
  }
}
