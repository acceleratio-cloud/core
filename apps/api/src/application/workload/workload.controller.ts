import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type {
  AddWorkloadDomainPayload,
  CreateWorkloadPayload,
  GenerateWorkloadDomainPayload,
  UpdateWorkloadDomainPayload,
  WorkloadDomain,
  WorkloadDomains,
  S3BucketCredentials,
  UpdateInternalHostnamePayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadEnv,
  WorkloadInstancesSnapshot,
  WorkloadVersion,
  WorkloadVersionDiff,
  WorkloadVersionDiffQuery,
} from '@acceleratio/shared';
import type { Observable } from 'rxjs';
import { DockerWorkloadNetworkService } from './docker/docker-workload-network.service';
import { WorkloadInstancesService } from './instances/workload-instances.service';
import { WorkloadEventsService } from './observer/workload-events.service';
import { WorkloadService } from './workload.service';
import type { VersionAuthorInput } from './workload-version.service';

/** The signed-in user, recorded as the author of the version they apply. */
const authorOf = (session: UserSession | null): VersionAuthorInput | null =>
  session
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      }
    : null;

@Controller('projects/:projectId/workloads')
export class WorkloadController {
  constructor(
    private readonly workloadService: WorkloadService,
    // Not `events`: an instance property would shadow the `events()` route
    // handler of the same name on the prototype.
    private readonly workloadEvents: WorkloadEventsService,
    private readonly workloadInstances: WorkloadInstancesService,
    private readonly network: DockerWorkloadNetworkService,
  ) {}

  @Get()
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Workload[]> {
    return this.workloadService.list(projectId);
  }

  // Registered before `:id`: the SSE route path is not a UUID.
  @Sse('events')
  @Header('X-Accel-Buffering', 'no')
  events(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Observable<MessageEvent> {
    return this.workloadEvents.toSse(projectId);
  }

  @Get(':id')
  get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.get(projectId, id);
  }

  /** The running copies of a Docker service with their live usage. */
  @Get(':id/instances')
  @Header('Cache-Control', 'no-store')
  instances(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkloadInstancesSnapshot> {
    return this.workloadInstances.get(projectId, id);
  }

  @Sse(':id/instances/events')
  @Header('X-Accel-Buffering', 'no')
  async instanceEvents(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Observable<MessageEvent>> {
    // Validated before the stream opens, so an unknown or non-Docker workload
    // answers 404/400 instead of an empty stream.
    await this.workloadInstances.assertDocker(projectId, id);

    return this.workloadInstances.stream(projectId, id);
  }

  /**
   * Domains of a Docker service. They apply to the cluster at once and are
   * not part of the versioned config, so no deploy is needed.
   */
  @Get(':id/domains')
  @Header('Cache-Control', 'no-store')
  domains(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkloadDomains> {
    return this.network.list(projectId, id);
  }

  /**
   * Renames the private hostname of a Docker service (`<hostname>.internal`).
   * Like domains it applies at once, without a deploy.
   */
  @Patch(':id/internal-hostname')
  updateInternalHostname(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInternalHostnamePayload,
  ): Promise<Workload> {
    return this.workloadService.updateInternalHostname(projectId, id, body);
  }

  @Post(':id/domains/generate')
  generateDomain(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateWorkloadDomainPayload,
  ): Promise<WorkloadDomain> {
    return this.network.generate(projectId, id, body);
  }

  @Post(':id/domains')
  addDomain(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddWorkloadDomainPayload,
  ): Promise<WorkloadDomain> {
    return this.network.addCustom(projectId, id, body);
  }

  @Patch(':id/domains/:domainId')
  updateDomain(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Body() body: UpdateWorkloadDomainPayload,
  ): Promise<WorkloadDomain> {
    return this.network.update(projectId, id, domainId, body);
  }

  @Post(':id/domains/:domainId/verify')
  @HttpCode(HttpStatus.OK)
  verifyDomain(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ): Promise<WorkloadDomain> {
    return this.network.verify(projectId, id, domainId);
  }

  @Delete(':id/domains/:domainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDomain(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ): Promise<void> {
    return this.network.remove(projectId, id, domainId);
  }

  @Post()
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateWorkloadPayload,
  ): Promise<Workload> {
    return this.workloadService.create(projectId, body);
  }

  /** The only route that returns environment variable values. */
  @Get(':id/env')
  @Header('Cache-Control', 'no-store')
  env(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkloadEnv> {
    return this.workloadService.env(projectId, id);
  }

  @Get(':id/credentials')
  @Header('Cache-Control', 'no-store')
  credentials(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<S3BucketCredentials> {
    return this.workloadService.credentials(projectId, id);
  }

  @Post(':id/credentials/rotate')
  @Header('Cache-Control', 'no-store')
  rotateCredentials(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<S3BucketCredentials> {
    return this.workloadService.rotateCredentials(projectId, id);
  }

  @Post(':id/deploy')
  @HttpCode(HttpStatus.OK)
  deploy(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession | null,
  ): Promise<Workload> {
    return this.workloadService.deploy(projectId, id, authorOf(session));
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.start(projectId, id);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  stop(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.stop(projectId, id);
  }

  @Post(':id/restart')
  @HttpCode(HttpStatus.OK)
  restart(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.restart(projectId, id);
  }

  @Get(':id/versions')
  listVersions(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkloadVersion[]> {
    return this.workloadService.listVersions(projectId, id);
  }

  /**
   * What differs between two sides: `active`, `draft` or a version id.
   * Registered before `:versionId`, whose path would otherwise match.
   */
  @Get(':id/versions/diff')
  @Header('Cache-Control', 'no-store')
  diffVersions(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: WorkloadVersionDiffQuery,
  ): Promise<WorkloadVersionDiff> {
    return this.workloadService.diffVersions(
      projectId,
      id,
      typeof query.base === 'string' && query.base ? query.base : 'active',
      typeof query.target === 'string' && query.target ? query.target : 'draft',
    );
  }

  @Get(':id/versions/:versionId')
  getVersion(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<WorkloadVersion> {
    return this.workloadService.getVersion(projectId, id, versionId);
  }

  /** What a rollback to the version would change, before it runs. */
  @Get(':id/versions/:versionId/rollback/preview')
  @Header('Cache-Control', 'no-store')
  previewRollback(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<WorkloadVersionDiff> {
    return this.workloadService.previewRollback(projectId, id, versionId);
  }

  @Post(':id/versions/:versionId/rollback')
  @HttpCode(HttpStatus.OK)
  rollback(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Session() session: UserSession | null,
  ): Promise<Workload> {
    return this.workloadService.rollback(
      projectId,
      id,
      versionId,
      authorOf(session),
    );
  }

  @Delete(':id/draft')
  discardDraft(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Workload> {
    return this.workloadService.discardDraft(projectId, id);
  }

  @Patch(':id')
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkloadPayload,
  ): Promise<Workload> {
    return this.workloadService.update(projectId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.workloadService.remove(projectId, id);
  }
}
