import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import {
  ACCESS_RULE,
  defaultRule,
  enforce,
  type Access,
  type AccessRule,
} from './access';
import { AccessService } from './access.service';

interface AccessRequest {
  method: string;
  params?: Record<string, string | undefined>;
  session?: UserSession | null;
  user?: unknown;
  access?: Access;
}

/**
 * Runs after better-auth's `AuthGuard` (registered right before it in
 * ApplicationModule) and decides what the signed-in account may do. Routes
 * with a `:projectId` param need a project level; every other route needs a
 * built-in role unless it says otherwise with `@RequireAccess`.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>('PUBLIC', targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AccessRequest>();

    // AuthGuard sets the session, null included, on every request it sees.
    if (request.session === undefined) {
      throw new InternalServerErrorException(
        'Access was checked before the session',
      );
    }

    // Only an optional route gets this far without a session.
    if (request.session === null) {
      return true;
    }

    const access = await this.access.resolve(request.session.user.id);

    if (!access) {
      if (this.reflector.getAllAndOverride<boolean>('OPTIONAL', targets)) {
        request.session = null;
        request.user = null;
        return true;
      }

      throw new UnauthorizedException('This account no longer has access');
    }

    request.access = access;

    const projectId = request.params?.projectId;
    const rule =
      this.reflector.getAllAndOverride<AccessRule | undefined>(
        ACCESS_RULE,
        targets,
      ) ?? defaultRule(request.method, projectId);

    enforce(access, rule, projectId);

    return true;
  }
}
