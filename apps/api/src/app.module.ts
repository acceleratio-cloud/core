import { Module } from '@nestjs/common';
import { ApplicationModule } from '@/application/application.module';
import { HttpShutdownService } from '@/common/http-shutdown.service';
import { VendorModule } from '@/vendor/vendor.module';

@Module({
  imports: [VendorModule, ApplicationModule],
  providers: [HttpShutdownService],
})
export class AppModule {}
