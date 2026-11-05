import { Module } from '@nestjs/common';
import { AuthController } from '@/application/auth/auth.controller';
import { HealthController } from '@/application/health/health.controller';
import { MetricsController } from '@/application/metrics/metrics.controller';
import { MetricsService } from '@/application/metrics/metrics.service';
import { NodeController } from '@/application/node/node.controller';
import { NodeService } from '@/application/node/node.service';
import { ProjectController } from '@/application/project/project.controller';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import { StorageBenchmarkController } from '@/application/storage-class/benchmark/storage-benchmark.controller';
import { StorageBenchmarkService } from '@/application/storage-class/benchmark/storage-benchmark.service';
import { StorageClassController } from '@/application/storage-class/storage-class.controller';
import { StorageClassService } from '@/application/storage-class/storage-class.service';
import { ControlPlaneDnsService } from '@/application/system/control-plane-dns.service';
import { ControlPlaneRoutingService } from '@/application/system/control-plane-routing.service';
import { SystemController } from '@/application/system/system.controller';
import { SystemService } from '@/application/system/system.service';
import { DockerWorkloadStatusDeriver } from '@/application/workload/docker/docker-workload.deriver';
import { DockerWorkloadNetworkService } from '@/application/workload/docker/docker-workload-network.service';
import { DockerWorkloadService } from '@/application/workload/docker/docker-workload.service';
import { S3BucketObjectsController } from '@/application/workload/s3-bucket/s3-bucket-objects.controller';
import { S3BucketObjectsService } from '@/application/workload/s3-bucket/s3-bucket-objects.service';
import { S3BucketWorkloadService } from '@/application/workload/s3-bucket/s3-bucket.service';
import { WorkloadInstancesService } from '@/application/workload/instances/workload-instances.service';
import { WorkloadEventsService } from '@/application/workload/observer/workload-events.service';
import { WorkloadMutationGuard } from '@/application/workload/observer/workload-mutation-guard';
import { WorkloadObserverService } from '@/application/workload/observer/workload-observer.service';
import { WorkloadSnapshotStore } from '@/application/workload/observer/workload-snapshot.store';
import { WorkloadStatusWriter } from '@/application/workload/observer/workload-status.writer';
import { WorkloadTerminalService } from '@/application/workload/terminal/workload-terminal.service';
import { WorkloadController } from '@/application/workload/workload.controller';
import { WorkloadService } from '@/application/workload/workload.service';
import { WorkloadStatusDeriverRegistry } from '@/application/workload/workload-status-deriver.registry';
import { WorkloadTypeRegistry } from '@/application/workload/workload-type.registry';
import { WorkloadTypeResolver } from '@/application/workload/workload-type.resolver';
import { WorkloadVersionService } from '@/application/workload/workload-version.service';
import { SeaweedfsFilerClient } from '@/vendor/seaweedfs/seaweedfs-filer.client';
import { TraefikClient } from '@/vendor/traefik/traefik.client';
import { VictoriaMetricsClient } from '@/vendor/victoriametrics/victoriametrics.client';

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
    HealthController,
    MetricsController,
    NodeController,
    ProjectController,
    StorageClassController,
    StorageBenchmarkController,
    SystemController,
    WorkloadController,
    S3BucketObjectsController,
  ],
  providers: [
    NodeService,
    ProjectService,
    ProjectIsolationService,
    StorageClassService,
    StorageBenchmarkService,
    ControlPlaneDnsService,
    ControlPlaneRoutingService,
    SystemService,
    DockerWorkloadStatusDeriver,
    DockerWorkloadService,
    DockerWorkloadNetworkService,
    S3BucketWorkloadService,
    S3BucketObjectsService,
    SeaweedfsFilerClient,
    TraefikClient,
    VictoriaMetricsClient,
    MetricsService,
    WorkloadStatusDeriverRegistry,
    WorkloadEventsService,
    WorkloadInstancesService,
    WorkloadTerminalService,
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
