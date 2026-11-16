import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
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
  AcceptInvitePayload,
  AuthSession,
  AuthStatusResponse,
  AuthSessionSummary,
  AuthUser,
  ChangePasswordPayload,
  ChangePasswordResponse,
  InvitePreview,
  SessionListResponse,
  SessionResponse,
  SignInEmailPayload,
  SignUpEmailPayload,
  UpdateProfilePayload,
} from '@acceleratio/shared';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { user } from '@/vendor/db/schema';
import { normalizeName } from '@/common/validation';
import {
  CurrentAccess,
  RequireAccess,
  toMemberAccess,
  type Access,
} from '@/application/member/access';
import {
  INVALID_INVITE_MESSAGE,
  MemberService,
} from '@/application/member/member.service';
import { AuthExceptionFilter } from './auth-exception.filter';
import { PasswordAttemptLimiter } from './password-attempt-limiter';

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
@RequireAccess('member')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly authService: AuthService,
    private readonly passwordLimiter: PasswordAttemptLimiter,
    private readonly members: MemberService,
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
    const userId = result.user.id;

    try {
      // A second, concurrent installation loses here: one owner only.
      await this.members.addOwner(userId);
    } catch (error) {
      await this.members.deleteUser(userId);
      throw error;
    }

    return this.serializeAuthResult(result);
  }

  @Get('invites/:token')
  @AllowAnonymous()
  invite(@Param('token') token: string): Promise<InvitePreview> {
    return this.members.previewInvite(token);
  }

  /** Creates the account an invite link grants and signs it in. */
  @Post('invites/:token/accept')
  @HttpCode(HttpStatus.OK)
  @AllowAnonymous()
  async acceptInvite(
    @Param('token') token: string,
    @Body() body: AcceptInvitePayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const name = normalizeName(body?.name);
    const { email, password } = body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new BadRequestException('Enter an email and a password');
    }

    const claimed = await this.members.claimInvite(token);

    if (!claimed) {
      throw new NotFoundException(INVALID_INVITE_MESSAGE);
    }

    let userId: string | undefined;

    try {
      const result = await this.forwardAuthResult(response, () =>
        this.authService.api.signUpEmail({
          body: { name, email, password },
          headers: fromNodeHeaders(request.headers),
          returnHeaders: true,
        }),
      );
      userId = result.user.id;
      await this.members.addFromInvite(userId, claimed);

      return this.serializeAuthResult(result);
    } catch (error) {
      // The link stays usable and no account is left without access.
      await this.members.releaseInvite(claimed.id);
      if (userId) {
        await this.members.deleteUser(userId);
      }
      throw error;
    }
  }

  @Post('sign-in/email')
  @HttpCode(HttpStatus.OK)
  @AllowAnonymous()
  async signInEmail(
    @Body() body: SignInEmailPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const result = await this.forwardAuthResult(response, async () => {
      const signedIn = await this.authService.api.signInEmail({
        body,
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });

      // Before any cookie is set: a valid password is not access.
      await this.members.assertMember(signedIn.response.user.id);

      return signedIn;
    });

    return this.serializeAuthResult(result);
  }

  @Get('session')
  @OptionalAuth()
  session(
    @Session() session: UserSession | null,
    @CurrentAccess() access: Access | undefined,
  ): SessionResponse {
    // AccessGuard clears the session of an account that has no access.
    if (!session || !access) {
      return { session: null, user: null, access: null };
    }

    return {
      session: this.toAuthSession(session.session),
      user: this.toAuthUser(session.user),
      access: toMemberAccess(access),
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

  /** The user changes only their own name; the email stays as installed. */
  @Patch('profile')
  async updateProfile(
    @Body() body: UpdateProfilePayload,
    @Req() request: Request,
    @Session() session: UserSession,
  ): Promise<AuthUser> {
    const name = normalizeName(body?.name);

    await this.authService.api.updateUser({
      body: { name },
      headers: fromNodeHeaders(request.headers),
    });

    return this.toAuthUser({ ...session.user, name, updatedAt: new Date() });
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: ChangePasswordPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Session() session: UserSession,
  ): Promise<ChangePasswordResponse> {
    const currentPassword = body?.current_password;
    const newPassword = body?.new_password;

    if (typeof currentPassword !== 'string' || !currentPassword) {
      throw new BadRequestException('Enter your current password');
    }

    if (typeof newPassword !== 'string' || !newPassword) {
      throw new BadRequestException('Enter a new password');
    }

    if (newPassword === currentPassword) {
      throw new BadRequestException(
        'The new password must differ from the current one',
      );
    }

    this.passwordLimiter.assertAllowed(session.user.id);

    let result: { headers: Headers };

    try {
      result = await this.authService.api.changePassword({
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: body.revoke_other_sessions ?? true,
        },
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
    } catch (error) {
      if (
        (error as { body?: { code?: string } }).body?.code ===
        'INVALID_PASSWORD'
      ) {
        this.passwordLimiter.recordFailure(session.user.id);
      }
      throw error;
    }

    this.passwordLimiter.reset(session.user.id);
    this.setCookies(response, result.headers);

    return { success: true };
  }

  @Get('sessions')
  async listSessions(
    @Req() request: Request,
    @Session() session: UserSession,
  ): Promise<SessionListResponse> {
    const sessions = await this.authService.api.listSessions({
      headers: fromNodeHeaders(request.headers),
    });

    return {
      sessions: (sessions as AuthSessionLike[]).map((item) =>
        this.toSessionSummary(item, session.session.id),
      ),
    };
  }

  @Delete('sessions/others')
  @HttpCode(HttpStatus.OK)
  async revokeOtherSessions(
    @Req() request: Request,
  ): Promise<ChangePasswordResponse> {
    await this.authService.api.revokeOtherSessions({
      headers: fromNodeHeaders(request.headers),
    });

    return { success: true };
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Param('id') id: string,
    @Req() request: Request,
    @Session() session: UserSession,
  ): Promise<ChangePasswordResponse> {
    if (id === session.session.id) {
      throw new BadRequestException('Use sign out to end the current session');
    }

    const headers = fromNodeHeaders(request.headers);
    // The token is the revoke handle in better-auth. It never leaves the API,
    // and listing the caller's own sessions keeps this scoped to them.
    const sessions = (await this.authService.api.listSessions({
      headers,
    })) as AuthSessionLike[];
    const target = sessions.find((item) => item.id === id);

    if (!target) {
      throw new NotFoundException('Session not found');
    }

    await this.authService.api.revokeSession({
      body: { token: target.token },
      headers,
    });

    return { success: true };
  }

  private setCookies(response: Response, headers: Headers) {
    const cookies = headers.getSetCookie();

    if (cookies.length > 0) {
      response.setHeader('set-cookie', cookies);
    }
  }

  private toSessionSummary(
    item: AuthSessionLike,
    currentId: string,
  ): AuthSessionSummary {
    return {
      id: item.id,
      created_at: this.toIsoString(item.createdAt),
      updated_at: this.toIsoString(item.updatedAt),
      expires_at: this.toIsoString(item.expiresAt),
      ip_address: item.ipAddress ?? null,
      user_agent: item.userAgent ?? null,
      current: item.id === currentId,
    };
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
