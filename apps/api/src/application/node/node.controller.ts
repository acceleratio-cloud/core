import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type {
  AddNodePayload,
  ClusterNode,
  NodePreflightResult,
  PreflightNodePayload,
  DeleteNodePayload,
  DrainNodePayload,
  NodeDrainPlan,
  NodeOperation,
  UpdateNodeLabelsPayload,
  UpdateNodeTaintsPayload,
} from '@acceleratio/shared';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { NodeDrainService } from './node-drain.service';
import { NodeJoinService } from './node-join.service';
import { NodeService } from './node.service';

const actorOf = (session: UserSession | null): string | null =>
  session?.user.email ?? session?.user.id ?? null;

@Controller('nodes')
export class NodeController {
  constructor(
    private readonly nodeService: NodeService,
    private readonly drainService: NodeDrainService,
    private readonly joinService: NodeJoinService,
  ) {}

  @Get()
  list(): Promise<ClusterNode[]> {
    return this.nodeService.list();
  }

  @Post('preflight')
  @HttpCode(200)
  preflight(
    @Body() payload: PreflightNodePayload,
  ): Promise<NodePreflightResult> {
    return this.joinService.preflight(payload);
  }

  @Post()
  @HttpCode(202)
  add(
    @Body() payload: AddNodePayload,
    @Session() session: UserSession | null,
  ): Promise<NodeOperation> {
    return this.joinService.add(payload, actorOf(session));
  }

  @Get(':name')
  get(@Param('name') name: string): Promise<ClusterNode> {
    return this.nodeService.get(name);
  }

  @Post(':name/cordon')
  @HttpCode(200)
  cordon(@Param('name') name: string): Promise<ClusterNode> {
    return this.nodeService.setSchedulable(name, false);
  }

  @Post(':name/uncordon')
  @HttpCode(200)
  uncordon(@Param('name') name: string): Promise<ClusterNode> {
    return this.nodeService.setSchedulable(name, true);
  }

  @Put(':name/labels')
  updateLabels(
    @Param('name') name: string,
    @Body() payload: UpdateNodeLabelsPayload,
  ): Promise<ClusterNode> {
    return this.nodeService.updateLabels(name, payload);
  }

  @Put(':name/taints')
  updateTaints(
    @Param('name') name: string,
    @Body() payload: UpdateNodeTaintsPayload,
  ): Promise<ClusterNode> {
    return this.nodeService.updateTaints(name, payload);
  }

  @Get(':name/drain-plan')
  drainPlan(@Param('name') name: string): Promise<NodeDrainPlan> {
    return this.drainService.plan(name);
  }

  @Get(':name/operation')
  operation(@Param('name') name: string): Promise<NodeOperation> {
    return this.drainService.current(name);
  }

  @Get(':name/operations')
  operations(@Param('name') name: string): Promise<NodeOperation[]> {
    return this.drainService.history(name);
  }

  @Post(':name/drain')
  @HttpCode(202)
  drain(
    @Param('name') name: string,
    @Body() payload: DrainNodePayload,
    @Session() session: UserSession | null,
  ): Promise<NodeOperation> {
    return this.drainService.drain(name, payload, actorOf(session));
  }

  @Delete(':name')
  @HttpCode(202)
  remove(
    @Param('name') name: string,
    @Body() payload: DeleteNodePayload,
    @Session() session: UserSession | null,
  ): Promise<NodeOperation> {
    return this.drainService.remove(name, payload, actorOf(session));
  }
}
