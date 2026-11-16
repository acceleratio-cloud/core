import { Module } from '@nestjs/common';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth';

@Module({
  imports: [
    BetterAuthModule.forRoot({
      auth,
      disableControllers: true,
      // ApplicationModule registers AuthGuard itself, right before AccessGuard.
      disableGlobalAuthGuard: true,
    }),
  ],
})
export class AuthModule {}
