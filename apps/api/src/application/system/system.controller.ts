import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import type {
  ControlPlaneDnsCheck,
  ControlPlaneSettings,
  SetControlPlaneUrlPayload,
} from '@acceleratio/shared';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('control-plane')
  getControlPlane(): Promise<ControlPlaneSettings> {
    return this.systemService.getControlPlane();
  }

  @Put('control-plane/pending')
  setPending(
    @Body() body: SetControlPlaneUrlPayload,
  ): Promise<ControlPlaneSettings> {
    return this.systemService.setPending(body);
  }

  @Post('control-plane/pending/dns-check')
  @HttpCode(HttpStatus.OK)
  checkDns(): Promise<ControlPlaneDnsCheck> {
    return this.systemService.checkDns();
  }

  @Delete('control-plane/pending')
  cancelPending(): Promise<ControlPlaneSettings> {
    return this.systemService.cancelPending();
  }

  @Post('control-plane/apply')
  @HttpCode(HttpStatus.OK)
  apply(): Promise<ControlPlaneSettings> {
    return this.systemService.apply();
  }
}
