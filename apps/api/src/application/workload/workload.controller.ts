import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
} from '@acceleratio/shared';
import type { Observable } from 'rxjs';
import { WorkloadEventsService } from './observer/workload-events.service';
import { WorkloadService } from './workload.service';

@Controller('projects/:projectId/workloads')
export class WorkloadController {
  constructor(
    private readonly workloadService: WorkloadService,
    // Not `events`: an instance property would shadow the `events()` route
    // handler of the same name on the prototype.
    private readonly workloadEvents: WorkloadEventsService,
  ) {}

  @Get()
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Workload[]> {
    return this.workloadService.list(projectId);
  }

  // Registered before `:id`: the SSE route path is not a UUID.
  @Sse('events')
  @Header('X-Accel-Buffering', 'no')
  events(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Observable<MessageEvent> {
    return this.workloadEvents.toSse(projectId);
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

  @Post(':id/deploy')
  @HttpCode(HttpStatus.OK)
  deploy(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.deploy(projectId, id);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.start(projectId, id);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  stop(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.stop(projectId, id);
  }

  @Post(':id/restart')
  @HttpCode(HttpStatus.OK)
  restart(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.restart(projectId, id);
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
