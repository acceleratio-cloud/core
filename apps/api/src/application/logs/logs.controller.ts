import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Sse,
  UnauthorizedException,
  type MessageEvent,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Observable } from 'rxjs';
import type {
  ProjectLogHistogram,
  ProjectLogSources,
  ProjectLogsPage,
} from '@acceleratio/shared';
import {
  LogsService,
  type LogsPageInput,
  type LogsQueryInput,
  type LogsStreamInput,
} from './logs.service';

/**
 * Project logs. Every endpoint takes the same filters: `range` (preset) or
 * `start` + `end` (RFC 3339), and repeatable `workload`, `pod`, `level`, plus
 * a `q` search phrase.
 */
@Controller('projects/:projectId/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  /** History, newest first; pass `next_cursor` back as `cursor`. */
  @Get()
  @Header('Cache-Control', 'no-store')
  page(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: LogsPageInput,
  ): Promise<ProjectLogsPage> {
    return this.logsService.getPage(projectId, query);
  }

  /** Lines per level over the window, for the frequency chart. */
  @Get('histogram')
  @Header('Cache-Control', 'no-store')
  histogram(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: LogsQueryInput,
  ): Promise<ProjectLogHistogram> {
    return this.logsService.getHistogram(projectId, query);
  }

  /** Services and pods with logs in the window, plus the live pods. */
  @Get('sources')
  @Header('Cache-Control', 'no-store')
  sources(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: LogsQueryInput,
  ): Promise<ProjectLogSources> {
    return this.logsService.getSources(projectId, query);
  }

  /**
   * Live lines as server-sent events. `since` resumes after the newest line
   * the client already has, so a reconnect neither repeats nor skips lines.
   */
  @Sse('stream')
  @Header('X-Accel-Buffering', 'no')
  stream(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: LogsStreamInput,
    @Session() session: UserSession | null,
  ): Promise<Observable<MessageEvent>> {
    const userId = session?.user?.id;

    if (!userId) {
      throw new UnauthorizedException();
    }

    return this.logsService.openStream(projectId, userId, query);
  }
}
