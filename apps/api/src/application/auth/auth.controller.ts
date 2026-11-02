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
  AuthSession,
  AuthStatusResponse,
  AuthUser,
  SessionResponse,
  SignInEmailPayload,
  SignUpEmailPayload,
} from '@acceleratio/shared';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { user } from '@/vendor/db/schema';
import { AuthExceptionFilter } from './auth-exception.filter';

/**
 * better-auth returns camelCase with Date objects. These structural shapes
 * describe only the fields this controller maps; anything else in the vendor
 * response passes through untouched.
 */
interface AuthUserLike {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface AuthSessionLike {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

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
  ): Promise<Record<string, unknown>> {
    const usersCount = await this.db.$count(user);

    if (usersCount > 0) {
      throw new ForbiddenException('Initial setup has already been completed');
    }

    const result = await this.forwardAuthResult(response, () =>
      this.authService.api.signUpEmail({
        body,
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      }),
    );

    return this.serializeAuthResult(result);
  }

  @Post('sign-in/email')
  @HttpCode(HttpStatus.OK)
  @AllowAnonymous()
  async signInEmail(
    @Body() body: SignInEmailPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const result = await this.forwardAuthResult(response, () =>
      this.authService.api.signInEmail({
        body,
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      }),
    );

    return this.serializeAuthResult(result);
  }

  @Get('session')
  @OptionalAuth()
  session(@Session() session: UserSession | null): SessionResponse {
    if (!session) {
      return { session: null, user: null };
    }

    return {
      session: this.toAuthSession(session.session),
      user: this.toAuthUser(session.user),
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

  private serializeAuthResult(result: object): Record<string, unknown> {
    const mapped: Record<string, unknown> = { ...result };
    const candidate = result as { user?: unknown; session?: unknown };

    if (this.isRecord(candidate.user)) {
      mapped.user = this.toAuthUser(candidate.user as unknown as AuthUserLike);
    }

    if (this.isRecord(candidate.session)) {
      mapped.session = this.toAuthSession(
        candidate.session as unknown as AuthSessionLike,
      );
    }

    return mapped;
  }

  private toAuthUser(user: AuthUserLike): AuthUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      email_verified: user.emailVerified,
      image: user.image ?? null,
      created_at: this.toIsoString(user.createdAt),
      updated_at: this.toIsoString(user.updatedAt),
    };
  }

  private toAuthSession(session: AuthSessionLike): AuthSession {
    return {
      id: session.id,
      token: session.token,
      user_id: session.userId,
      expires_at: this.toIsoString(session.expiresAt),
      created_at: this.toIsoString(session.createdAt),
      updated_at: this.toIsoString(session.updatedAt),
      ip_address: session.ipAddress ?? null,
      user_agent: session.userAgent ?? null,
    };
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
