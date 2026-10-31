import { Module } from '@nestjs/common';
import { AuthController } from '@/application/auth/auth.controller';
import { NodeController } from '@/application/node/node.controller';
import { NodeService } from '@/application/node/node.service';
import { ProjectController } from '@/application/project/project.controller';
import { ProjectService } from '@/application/project/project.service';

@Module({
  controllers: [AuthController, NodeController, ProjectController],
  providers: [NodeService, ProjectService],
})
export class ApplicationModule {}
