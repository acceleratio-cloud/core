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
import { ProjectService } from './project.service';

@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  list(): Promise<Project[]> {
    return this.projectService.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Project> {
    return this.projectService.get(id);
  }

  @Post()
  create(@Body() body: CreateProjectPayload): Promise<Project> {
    return this.projectService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProjectPayload,
  ): Promise<Project> {
    return this.projectService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projectService.remove(id);
  }
}
