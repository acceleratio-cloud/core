import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  AllowAnonymous,
  AuthService,
  OptionalAuth,
  Session,
  type UserSession,
} from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import type {
  AuthStatusResponse,
  SignInEmailPayload,
  SignUpEmailPayload,
} from '@acceleratio/shared';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { user } from '@/vendor/db/schema';
import { AuthExceptionFilter } from './auth-exception.filter';

@UseFilters(AuthExceptionFilter)
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authService: AuthService,
  ) {}

  @Get('status')
  @AllowAnonymous()
  async status(): Promise<AuthStatusResponse> {
    const usersCount = await this.db.$count(user);

    return { initialized: usersCount > 0 };
  }

  @Post('sign-up/email')
  @HttpCode(HttpStatus.OK)
  @AllowAnonymous()
  async signUpEmail(
    @Body() body: SignUpEmailPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const usersCount = await this.db.$count(user);

    if (usersCount > 0) {
      throw new ForbiddenException('Initial setup has already been completed');
    }

    return this.forwardAuthResult(response, () =>
      this.authService.api.signUpEmail({
        body,
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      }),
    );
  }

  @Post('sign-in/email')
  @HttpCode(HttpStatus.OK)
  @AllowAnonymous()
  signInEmail(
    @Body() body: SignInEmailPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.forwardAuthResult(response, () =>
      this.authService.api.signInEmail({
        body,
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      }),
    );
  }

  @Get('session')
  @OptionalAuth()
  session(@Session() session: UserSession | null) {
    return {
      session: session?.session ?? null,
      user: session?.user ?? null,
    };
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.OK)
  signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.forwardAuthResult(response, () =>
      this.authService.api.signOut({
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      }),
    );
  }

  private async forwardAuthResult<T>(
    response: Response,
    call: () => Promise<{ headers: Headers; response: T }>,
  ): Promise<T> {
    const result = await call();
    const cookies = result.headers.getSetCookie();

    if (cookies.length > 0) {
      response.setHeader('set-cookie', cookies);
    }

    return result.response;
  }
}
