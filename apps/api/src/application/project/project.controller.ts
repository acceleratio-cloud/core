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
  CreateProjectPayload,
  Project,
  UpdateProjectPayload,
} from '@acceleratio/shared';
import {
  CurrentAccess,
  RequireAccess,
  type Access,
} from '@/application/member/access';
import { WorkloadService } from '@/application/workload/workload.service';
import { ProjectService } from './project.service';

@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly workloadService: WorkloadService,
  ) {}

  @Get()
  @RequireAccess('member')
  async list(@CurrentAccess() access: Access): Promise<Project[]> {
    const projects = await this.projectService.list();

    // A custom role sees only the projects it is granted.
    return access.projects
      ? projects.filter((item) => access.projects!.has(item.id))
      : projects;
  }

  @Get(':projectId')
  get(@Param('projectId', ParseUUIDPipe) id: string): Promise<Project> {
    return this.projectService.get(id);
  }

  @Post()
  create(@Body() body: CreateProjectPayload): Promise<Project> {
    return this.projectService.create(body);
  }

  @Patch(':projectId')
  update(
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() body: UpdateProjectPayload,
  ): Promise<Project> {
    return this.projectService.update(id, body);
  }

  @Delete(':projectId')
  @RequireAccess({ project: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('projectId', ParseUUIDPipe) id: string): Promise<void> {
    return this.workloadService.removeProject(id);
  }
}
