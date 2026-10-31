import { Module } from '@nestjs/common';
import { AuthController } from '@/application/auth/auth.controller';
import { NodeController } from '@/application/node/node.controller';
import { NodeService } from '@/application/node/node.service';

@Module({
  controllers: [AuthController, NodeController],
  providers: [NodeService],
})
export class ApplicationModule {}
