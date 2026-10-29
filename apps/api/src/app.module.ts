import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApplicationModule } from './application/application.module';
import { DatabaseModule } from './core/db/database.module';
import { auth } from './vendor/auth/auth';

@Module({
  imports: [AuthModule.forRoot({ auth }), DatabaseModule, ApplicationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
