import { Module } from '@nestjs/common';
import { ApplicationModule } from '@/application/application.module';
import { VendorModule } from '@/vendor/vendor.module';

@Module({
  imports: [VendorModule, ApplicationModule],
})
export class AppModule {}
