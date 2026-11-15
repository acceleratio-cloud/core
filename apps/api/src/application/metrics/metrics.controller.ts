import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  METRICS_RANGES,
  type ClusterCapacityOverview,
  type ProjectMetrics,
  type ProjectTraffic,
  type VolumeUsage,
} from '@acceleratio/shared';
import { DEFAULT_METRICS_RANGE, isMetricsRange } from './metrics-query';
import { MetricsService } from './metrics.service';

@Controller('projects/:projectId/metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('range') range?: string,
  ): Promise<ProjectMetrics> {
    const selected = range ?? DEFAULT_METRICS_RANGE;

    if (!isMetricsRange(selected)) {
      throw new BadRequestException(
        `range must be one of ${METRICS_RANGES.join(', ')}`,
      );
    }

    return this.metricsService.getProjectMetrics(projectId, selected);
  }

  @Get('volumes')
  volumes(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<VolumeUsage[]> {
    return this.metricsService.getVolumeUsage(projectId);
  }

  @Get('traffic')
  traffic(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectTraffic> {
    return this.metricsService.getProjectTraffic(projectId);
  }
}

@Controller('cluster')
export class ClusterMetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('capacity')
  capacity(): Promise<ClusterCapacityOverview> {
    return this.metricsService.getClusterCapacity();
  }
}
