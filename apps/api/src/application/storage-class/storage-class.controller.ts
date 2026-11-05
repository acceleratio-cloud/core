import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  CreateStorageClassPayload,
  StorageClass,
  StorageEnvironment,
  UpdateStorageClassPayload,
} from '@acceleratio/shared';
import { StorageClassService } from './storage-class.service';

@Controller('storage-classes')
export class StorageClassController {
  constructor(private readonly storageClassService: StorageClassService) {}

  @Get()
  list(): Promise<StorageClass[]> {
    return this.storageClassService.list();
  }

  // Declared before `:id` so the path is not parsed as a UUID.
  @Get('environment')
  environment(): Promise<StorageEnvironment> {
    return this.storageClassService.environment();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<StorageClass> {
    return this.storageClassService.get(id);
  }

  @Post()
  create(@Body() body: CreateStorageClassPayload): Promise<StorageClass> {
    return this.storageClassService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStorageClassPayload,
  ): Promise<StorageClass> {
    return this.storageClassService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.storageClassService.remove(id);
  }
}
