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
  type ProjectMetrics,
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
}
