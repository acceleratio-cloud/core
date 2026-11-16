import type { ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Access } from '@/application/member/access';

/** Stands in for AuthGuard + AccessGuard: every request is the owner's. */
export const signedInOwner = [
  {
    provide: APP_GUARD,
    useValue: {
      canActivate: (context: ExecutionContext) => {
        const access: Access = {
          userId: 'owner-1',
          role: 'owner',
          roleId: null,
          projects: null,
        };
        context.switchToHttp().getRequest<{ access: Access }>().access = access;
        return true;
      },
    },
  },
];
