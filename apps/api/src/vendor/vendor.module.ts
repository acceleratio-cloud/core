import { Module } from '@nestjs/common';
import { AuthModule } from '@/vendor/auth/auth.module';
import { DatabaseModule } from '@/vendor/db/database.module';

@Module({
  imports: [DatabaseModule, AuthModule],
})
export class VendorModule {}
