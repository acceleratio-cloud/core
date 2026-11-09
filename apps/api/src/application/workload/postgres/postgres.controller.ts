import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  PostgresCredentials,
  PostgresExposure,
  PostgresOverview,
  PostgresRows,
  PostgresTable,
  UpdatePostgresExposurePayload,
} from '@acceleratio/shared';
import { PostgresAccessService } from './postgres-access.service';
import { PostgresOverviewService } from './postgres-overview.service';

/**
 * A PostgreSQL workload's Overview tab (state, structure, rows), its external
 * access and its credentials.
 */
@Controller('projects/:projectId/workloads/:id/postgres')
export class PostgresController {
  constructor(
    private readonly overview: PostgresOverviewService,
    private readonly access: PostgresAccessService,
  ) {}

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
