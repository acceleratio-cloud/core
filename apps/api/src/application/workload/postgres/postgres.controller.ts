import {
  Body,
  Controller,
  Get,
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
  PostgresBackups,
  PostgresCredentials,
  PostgresImportResult,
  PostgresExposure,
  PostgresOverview,
  PostgresRows,
  PostgresTable,
  RestorePostgresPayload,
  UpdatePostgresExposurePayload,
  Workload,
} from '@acceleratio/shared';
import { contentDisposition } from '../s3-bucket/s3-bucket-objects.service';
import { PostgresBackupService } from './postgres-backup.service';
import { PostgresAccessService } from './postgres-access.service';
import { PostgresOverviewService } from './postgres-overview.service';
import { PostgresWorkloadService } from './postgres.service';

/**
 * A PostgreSQL workload's Overview tab (state, structure, rows), its external
 * access and its credentials.
 */
@Controller('projects/:projectId/workloads/:id/postgres')
export class PostgresController {
  constructor(
    private readonly overview: PostgresOverviewService,
    private readonly access: PostgresAccessService,
    private readonly backups: PostgresBackupService,
    private readonly databases: PostgresWorkloadService,
  ) {}

  /** The `app` database as a pg_dump custom-format file, current state. */
  @Get('dump')
  async dump(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const file = await this.overview.dump(projectId, id);

    return new StreamableFile(file.body, {
      type: 'application/octet-stream',
      disposition: contentDisposition(file.name),
    });
  }

  /**
   * Loads a dump sent as the raw request body (pg_dump `-Fc` or SQL) into
   * the database in one transaction.
   */
  @Post('import')
  import(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<PostgresImportResult> {
    return this.overview.import(projectId, id, request);
  }

  @Get('backups')
  listBackups(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostgresBackups> {
    return this.backups.list(projectId, id);
  }

  @Post('backups')
  backUp(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostgresBackups> {
    return this.backups.backUp(projectId, id);
  }

  /** A new database from this one's backups; this one is left as it is. */
  @Post('restore')
  restore(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: RestorePostgresPayload,
  ): Promise<Workload> {
    return this.databases.restore(projectId, id, payload);
  }

  @Get('overview')
  state(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostgresOverview> {
    return this.overview.overview(projectId, id);
  }

  @Get('tables')
  tables(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostgresTable[]> {
    return this.overview.tables(projectId, id);
  }

  @Get('tables/:schema/:table/rows')
  rows(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schema') schema: string,
    @Param('table') table: string,
    @Query('page') page?: string,
  ): Promise<PostgresRows> {
    return this.overview.rows(projectId, id, schema, table, page);
  }

  @Get('exposure')
  exposure(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostgresExposure> {
    return this.access.exposure(projectId, id);
  }

  @Put('exposure')
  updateExposure(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: UpdatePostgresExposurePayload,
  ): Promise<PostgresExposure> {
    return this.access.updateExposure(projectId, id, payload);
  }

  /** The current password; the console asks for it only on a click. */
  @Get('credentials')
  credentials(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostgresCredentials> {
    return this.access.credentials(projectId, id);
  }

  /** The new password is in this response only. */
  @Post('credentials/rotate')
  rotateCredentials(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostgresCredentials> {
    return this.access.rotateCredentials(projectId, id);
  }
}
