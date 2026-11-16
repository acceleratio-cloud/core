import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { takeUntil, type Observable } from 'rxjs';
import type { Access } from './access';
import { AccessService } from './access.service';

/**
 * A live stream (`@Sse`) outlives the request AccessGuard checked: end it when
 * its viewer's access changes. The browser reconnects and is checked again.
 */
@Injectable()
export class AccessRevocationInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const userId = context.switchToHttp().getRequest<{ access?: Access }>()
      .access?.userId;
    const stream = this.reflector.get<boolean | undefined>(
      SSE_METADATA,
      context.getHandler(),
    );

    return stream && userId
      ? next.handle().pipe(takeUntil(this.access.revoked(userId)))
      : next.handle();
  }
}
