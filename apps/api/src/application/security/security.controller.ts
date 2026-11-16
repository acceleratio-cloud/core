import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type {
  AcceptRiskPayload,
  ImageVulnerabilities,
  ProjectSecurity,
} from '@acceleratio/shared';
import { SecurityService } from './security.service';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

@Controller('projects/:projectId/security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get()
  get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSecurity> {
    return this.security.get(projectId);
  }

  @Get('images/:digest')
  vulnerabilities(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('digest') digest: string,
  ): Promise<ImageVulnerabilities> {
    if (!DIGEST.test(digest)) {
      throw new BadRequestException('digest must be sha256:<64 hex>');
    }

    return this.security.vulnerabilities(projectId, digest);
  }

  @Post('scan')
  scan(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSecurity> {
    return this.security.rescan(projectId);
  }

  @Post('acceptances')
  acceptRisk(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() payload: AcceptRiskPayload,
    @Session() session: UserSession | null,
  ): Promise<ProjectSecurity> {
    return this.security.acceptRisk(
      projectId,
      payload,
      session ? session.user.name || session.user.email : null,
    );
  }

  @Delete('acceptances/:recommendationId')
  restoreRisk(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('recommendationId') recommendationId: string,
  ): Promise<ProjectSecurity> {
    return this.security.restoreRisk(projectId, recommendationId);
  }
}
