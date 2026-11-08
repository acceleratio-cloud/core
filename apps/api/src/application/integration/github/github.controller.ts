import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import type {
  CreateGithubAppPayload,
  GithubAppManifestRequest,
  GithubInstallUrl,
  GithubIntegration,
  GithubRepository,
} from '@acceleratio/shared';
import {
  type InstallationPayload,
  GithubService,
  INVALID_STATE_MESSAGE,
} from './github.service';
import {
  type GithubPushPayload,
  GithubWorkloadService,
} from '@/application/workload/github/github-workload.service';
import { verifyWebhookSignature } from './github-webhook';

const INVALID_SIGNATURE_MESSAGE = 'Invalid webhook signature';

/**
 * `callback`, `installed` and `webhook` are called by GitHub, not by a signed-in
 * browser session, so they are anonymous: a signed `state` (browser redirects)
 * or the App's webhook secret (deliveries) is what authenticates them.
 */
@Controller('integrations/github')
export class GithubController {
  constructor(
    private readonly github: GithubService,
    private readonly githubWorkloads: GithubWorkloadService,
  ) {}

  @Get()
  list(): Promise<GithubIntegration> {
    return this.github.list();
  }

  @Post('apps/manifest')
  @HttpCode(HttpStatus.OK)
  createManifest(
    @Body() body: CreateGithubAppPayload,
    @Session() session: UserSession,
  ): Promise<GithubAppManifestRequest> {
    return this.github.createManifest(body, session.user.id);
  }

  @Get('manifest/callback')
  @AllowAnonymous()
  async manifestCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.redirectAfter(res, state, () =>
      this.github.completeManifest(code ?? '', state ?? ''),
    );
  }

  @Post('apps/:id/install-url')
  @HttpCode(HttpStatus.OK)
  installUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { return_url: string },
  ): Promise<GithubInstallUrl> {
    return this.github.installUrl(id, body.return_url);
  }

  @Get('apps/:id/installed')
  @AllowAnonymous()
  async installed(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('installation_id', ParseIntPipe) installationId: number,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.redirectAfter(res, state, () =>
      this.github.completeInstall(id, installationId, state ?? ''),
    );
  }

  @Get('apps/:id/repositories')
  repositories(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GithubRepository[]> {
    return this.github.repositories(id);
  }

  @Get('apps/:id/branches')
  branches(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('repository') repository: string | undefined,
  ): Promise<string[]> {
    return this.github.branches(id, repository ?? '');
  }

  @Delete('apps/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.github.remove(id);
  }

  @Post('apps/:id/webhook')
  @AllowAnonymous()
  @HttpCode(HttpStatus.NO_CONTENT)
  async webhook(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Body() body: InstallationPayload & GithubPushPayload,
  ): Promise<void> {
    const secret = await this.github.webhookSecret(id);
    if (!verifyWebhookSignature(secret, req.rawBody, signature)) {
      throw new BadRequestException(INVALID_SIGNATURE_MESSAGE);
    }
    if (event === 'push') {
      // GitHub gives up on a delivery after 10 s; checkout and Job creation
      // can take longer, so the deploys run after the answer.
      void this.githubWorkloads.handlePush(id, body);
      return;
    }
    await this.github.handleWebhook(id, event, body);
  }

  /**
   * Runs a GitHub redirect step and sends the browser back to the console. A
   * failure after a valid `state` is shown there; without one it is a plain 400.
   */
  private async redirectAfter(
    res: Response,
    state: string | undefined,
    step: () => Promise<string>,
  ): Promise<void> {
    try {
      res.redirect(HttpStatus.FOUND, await step());
    } catch (error) {
      const origin = state ? this.github.returnOriginOf(state) : null;
      if (!origin) {
        throw error instanceof BadRequestException
          ? error
          : new BadRequestException(INVALID_STATE_MESSAGE);
      }
      const message =
        error instanceof Error ? error.message : 'Something went wrong';
      res.redirect(
        HttpStatus.FOUND,
        this.github.returnUrl(origin, 'error', message),
      );
    }
  }
}
