import { Controller, Get } from '@nestjs/common';
import type { ClusterNode } from '@acceleratio/shared';
import { NodeService } from './node.service';

@Controller('nodes')
export class NodeController {
  constructor(private readonly nodeService: NodeService) {}

  @Get()
  list(): Promise<ClusterNode[]> {
    return this.nodeService.list();
  }
}
