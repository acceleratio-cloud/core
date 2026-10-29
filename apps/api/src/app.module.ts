import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApplicationModule } from '@/application/application.module';
import { VendorModule } from '@/vendor/vendor.module';

@Module({
  imports: [VendorModule, ApplicationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
