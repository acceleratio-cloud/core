import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  StorageBenchmark,
  StorageBenchmarkHistory,
  StorageBenchmarkReport,
} from '@acceleratio/shared';
import {
  StorageBenchmarkService,
  type BenchmarkHistoryQuery,
} from './storage-benchmark.service';

@Controller()
export class StorageBenchmarkController {
  constructor(private readonly storageBenchmarks: StorageBenchmarkService) {}

  /** Runs across all profiles: `?storage_class_id=&before=&limit=`. */
  @Get('storage-benchmarks')
  history(
    @Query() query: BenchmarkHistoryQuery,
  ): Promise<StorageBenchmarkHistory> {
    return this.storageBenchmarks.history(query);
  }

  /** One run with per-test detail, progress series and the previous run. */
  @Get('storage-benchmarks/:id')
  report(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StorageBenchmarkReport> {
    return this.storageBenchmarks.report(id);
  }

  @Get('storage-classes/:storageClassId/benchmarks')
  list(
    @Param('storageClassId', ParseUUIDPipe) storageClassId: string,
  ): Promise<StorageBenchmark[]> {
    return this.storageBenchmarks.list(storageClassId);
  }

  @Post('storage-classes/:storageClassId/benchmarks')
  start(
    @Param('storageClassId', ParseUUIDPipe) storageClassId: string,
  ): Promise<StorageBenchmark> {
    return this.storageBenchmarks.start(storageClassId);
  }
}
