import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

/**
 * Liveness probe for container HEALTHCHECKs and Kubernetes. It answers as soon
 * as the HTTP server is up and deliberately checks no dependency: a database or
 * cluster outage must not make the orchestrator restart every API replica.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  @AllowAnonymous()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
