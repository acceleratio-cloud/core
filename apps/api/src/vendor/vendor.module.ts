import { Module } from '@nestjs/common';
import { AuthModule } from '@/vendor/auth/auth.module';
import { DatabaseModule } from '@/vendor/db/database.module';
import { KubernetesModule } from '@/vendor/kubernetes/kubernetes.module';

@Module({
  imports: [DatabaseModule, AuthModule, KubernetesModule],
})
export class VendorModule {}
