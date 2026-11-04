import { Module } from '@nestjs/common';
import { AuthController } from '@/application/auth/auth.controller';
import { NodeController } from '@/application/node/node.controller';
import { NodeService } from '@/application/node/node.service';
import { ProjectController } from '@/application/project/project.controller';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import { StorageClassController } from '@/application/storage-class/storage-class.controller';
import { StorageClassService } from '@/application/storage-class/storage-class.service';
import { DockerWorkloadStatusDeriver } from '@/application/workload/docker/docker-workload.deriver';
import { DockerWorkloadService } from '@/application/workload/docker/docker-workload.service';
import { WorkloadEventsService } from '@/application/workload/observer/workload-events.service';
import { WorkloadMutationGuard } from '@/application/workload/observer/workload-mutation-guard';
import { WorkloadObserverService } from '@/application/workload/observer/workload-observer.service';
import { WorkloadSnapshotStore } from '@/application/workload/observer/workload-snapshot.store';
import { WorkloadStatusWriter } from '@/application/workload/observer/workload-status.writer';
import { WorkloadController } from '@/application/workload/workload.controller';
import { WorkloadService } from '@/application/workload/workload.service';
import { WorkloadStatusDeriverRegistry } from '@/application/workload/workload-status-deriver.registry';
import { WorkloadTypeRegistry } from '@/application/workload/workload-type.registry';
import { WorkloadTypeResolver } from '@/application/workload/workload-type.resolver';
import { WorkloadVersionService } from '@/application/workload/workload-version.service';

/**
 * Single Nest module for every application submodule. A submodule owns its
 * controller, its service and its Drizzle schemas, but never a module of its
 * own: one shared injector keeps service-to-service dependencies (workloads
 * needs projects) from turning into module-level cycles. See
 * docs/FILE_STRUCTURE.md.
 */
@Module({
  controllers: [
    AuthController,
    NodeController,
    ProjectController,
    StorageClassController,
    WorkloadController,
  ],
  providers: [
    NodeService,
    ProjectService,
    ProjectIsolationService,
    StorageClassService,
    DockerWorkloadStatusDeriver,
    DockerWorkloadService,
    WorkloadStatusDeriverRegistry,
    WorkloadEventsService,
    WorkloadMutationGuard,
    WorkloadSnapshotStore,
    WorkloadStatusWriter,
    WorkloadObserverService,
    WorkloadTypeRegistry,
    WorkloadTypeResolver,
    WorkloadVersionService,
    WorkloadService,
  ],
})
export class ApplicationModule {}
