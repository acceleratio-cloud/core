import { Module } from '@nestjs/common';
import { AuthController } from '@/application/auth/auth.controller';

@Module({
  controllers: [AuthController],
})
export class ApplicationModule {}
