import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { StorageBenchmark } from '@acceleratio/shared';
import { StorageBenchmarkService } from './storage-benchmark.service';

@Controller('storage-classes/:storageClassId/benchmarks')
export class StorageBenchmarkController {
  constructor(private readonly storageBenchmarks: StorageBenchmarkService) {}

  @Get()
  list(
    @Param('storageClassId', ParseUUIDPipe) storageClassId: string,
  ): Promise<StorageBenchmark[]> {
    return this.storageBenchmarks.list(storageClassId);
  }

  @Post()
  start(
    @Param('storageClassId', ParseUUIDPipe) storageClassId: string,
  ): Promise<StorageBenchmark> {
    return this.storageBenchmarks.start(storageClassId);
  }
}
