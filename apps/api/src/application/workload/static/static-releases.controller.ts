import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { StaticRelease, Workload } from '@acceleratio/shared';
import { StaticWorkloadService } from './static-workload.service';

/**
 * Uploads of a static site. A release is filled file by file, each sent as
 * the raw request body (`application/octet-stream`, which no body parser
 * touches) with its type in `X-Content-Type`, then published as the draft's
 * files and deployed.
 */
@Controller('projects/:projectId/workloads/:id/releases')
export class StaticReleasesController {
  constructor(private readonly sites: StaticWorkloadService) {}

  @Post()
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StaticRelease> {
    return this.sites.createRelease(projectId, id);
  }

  @Put(':releaseId/files')
  @HttpCode(HttpStatus.NO_CONTENT)
  upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @Query('path') path: string,
    @Req() request: Request,
  ): Promise<void> {
    const type = request.headers['x-content-type'];

    return this.sites.uploadFile(
      projectId,
      id,
      releaseId,
      path,
      request,
      Array.isArray(type) ? type[0] : type,
    );
  }

  @Post(':releaseId/publish')
  publish(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
  ): Promise<Workload> {
    return this.sites.publishRelease(projectId, id, releaseId);
  }
}
