import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { AuditLogPage, AuditLogWorkload } from '@acceleratio/shared';
import { ProjectService } from '@/application/project/project.service';
import { AuditLogService } from './audit-log.service';

@Controller('projects/:projectId/audit-logs')
export class AuditLogController {
  constructor(
    private readonly audit: AuditLogService,
    private readonly projects: ProjectService,
  ) {}

  @Get('workloads')
  async workloads(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<AuditLogWorkload[]> {
    await this.projects.get(projectId);
    return this.audit.workloads(projectId);
  }

  @Get()
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
    @Query('workload_id') workloadId?: string,
  ): Promise<AuditLogPage> {
    await this.projects.get(projectId);
    return this.audit.list(projectId, {
      before: before || undefined,
      limit: limit ? Number(limit) || undefined : undefined,
      workloadId: workloadId || undefined,
    });
  }
}
