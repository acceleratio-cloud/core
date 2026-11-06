import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type {
  PlatformUpdate,
  PlatformUpdateDetails,
  PlatformVersionInfo,
  StartPlatformUpdatePayload,
} from '@acceleratio/shared';
import { PlatformUpdateService } from './platform-update.service';

const actorOf = (session: UserSession | null): string | null =>
  session?.user.email ?? session?.user.id ?? null;

@Controller('system/platform')
export class PlatformUpdateController {
  constructor(private readonly updates: PlatformUpdateService) {}

  @Get()
  info(): Promise<PlatformVersionInfo> {
    return this.updates.info();
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  check(): Promise<PlatformVersionInfo> {
    return this.updates.check();
  }

  @Get('updates')
  list(): Promise<PlatformUpdate[]> {
    return this.updates.list();
  }

  @Post('updates')
  start(
    @Body() body: StartPlatformUpdatePayload,
    @Session() session: UserSession | null,
  ): Promise<PlatformUpdateDetails> {
    return this.updates.start(body, actorOf(session));
  }

  @Get('updates/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformUpdateDetails> {
    return this.updates.get(id);
  }
}
