import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  CreateS3FolderPayload,
  S3BucketEntry,
  S3BucketListing,
} from '@acceleratio/shared';
import {
  contentDisposition,
  S3BucketObjectsService,
} from './s3-bucket-objects.service';

/**
 * The contents of an S3 bucket workload, for the console's explorer. Files
 * are uploaded as the raw request body (`application/octet-stream`, which no
 * body parser touches) and streamed through, so their size is not limited by
 * the API's memory. The file's own type travels in `X-Content-Type`.
 */
@Controller('projects/:projectId/workloads/:id/objects')
export class S3BucketObjectsController {
  constructor(private readonly objects: S3BucketObjectsService) {}

  @Get()
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('prefix') prefix?: string,
  ): Promise<S3BucketListing> {
    return this.objects.list(projectId, id, prefix);
  }

  @Post('folders')
  createFolder(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: CreateS3FolderPayload,
  ): Promise<S3BucketEntry> {
    return this.objects.createFolder(projectId, id, payload?.path);
  }

  @Put('content')
  upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('path') path: string,
    @Req() request: Request,
  ): Promise<S3BucketEntry> {
    const type = request.headers['x-content-type'];

    return this.objects.upload(
      projectId,
      id,
      path,
      request,
      Array.isArray(type) ? type[0] : type,
    );
  }

  @Get('content')
  async download(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('path') path: string,
  ): Promise<StreamableFile> {
    const file = await this.objects.download(projectId, id, path);

    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: contentDisposition(file.name),
      ...(file.contentLength === null ? {} : { length: file.contentLength }),
    });
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('path') path: string,
    @Query('kind') kind?: string,
  ): Promise<void> {
    return this.objects.remove(
      projectId,
      id,
      path,
      kind === 'folder' ? 'folder' : 'file',
    );
  }
}
