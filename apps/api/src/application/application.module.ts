import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogController } from '@/application/audit/audit-log.controller';
import { AuditLogInterceptor } from '@/application/audit/audit-log.interceptor';
import { AuditLogService } from '@/application/audit/audit-log.service';
import { AuthController } from '@/application/auth/auth.controller';
import { PasswordAttemptLimiter } from '@/application/auth/password-attempt-limiter';
import { HealthController } from '@/application/health/health.controller';
import { GithubController } from '@/application/integration/github/github.controller';
import { GithubService } from '@/application/integration/github/github.service';
import { MarketplaceController } from '@/application/marketplace/marketplace.controller';
import { MarketplaceDeployService } from '@/application/marketplace/marketplace-deploy.service';
import { MarketplaceService } from '@/application/marketplace/marketplace.service';
import { LogsController } from '@/application/logs/logs.controller';
import { LogsService } from '@/application/logs/logs.service';
import { MetricsController } from '@/application/metrics/metrics.controller';
import { MetricsService } from '@/application/metrics/metrics.service';
import { NodeController } from '@/application/node/node.controller';
import { NodeService } from '@/application/node/node.service';
import { NodeDrainService } from '@/application/node/node-drain.service';
import { NodeJoinService } from '@/application/node/node-join.service';
import { NodeOperationStore } from '@/application/node/node-operation.store';
import { Ssh2Connector, SshConnector } from '@/application/node/node-ssh';
import { PlatformReleaseService } from '@/application/platform-update/platform-release.service';
import { PlatformUpdateController } from '@/application/platform-update/platform-update.controller';
import { PlatformUpdateService } from '@/application/platform-update/platform-update.service';
import { PlatformVersionService } from '@/application/platform-update/platform-version.service';
import { ProjectController } from '@/application/project/project.controller';
import { ProjectDnsService } from '@/application/project/project-dns.service';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import { StorageBenchmarkController } from '@/application/storage-class/benchmark/storage-benchmark.controller';
import { StorageBenchmarkService } from '@/application/storage-class/benchmark/storage-benchmark.service';
import { StorageClassController } from '@/application/storage-class/storage-class.controller';
import { StorageClassService } from '@/application/storage-class/storage-class.service';
import { ControlPlaneDnsService } from '@/application/system/control-plane-dns.service';
import { ControlPlaneRoutingService } from '@/application/system/control-plane-routing.service';
import { SystemController } from '@/application/system/system.controller';
import { SystemStatusService } from '@/application/system/system-status.service';
import { SystemService } from '@/application/system/system.service';
import { DockerWorkloadStatusDeriver } from '@/application/workload/docker/docker-workload.deriver';
import { DockerWorkloadNetworkService } from '@/application/workload/docker/docker-workload-network.service';
import { DockerWorkloadService } from '@/application/workload/docker/docker-workload.service';
import { GithubWorkloadService } from '@/application/workload/github/github-workload.service';
import { PostgresAccessService } from '@/application/workload/postgres/postgres-access.service';
import { PostgresBackupService } from '@/application/workload/postgres/postgres-backup.service';
import { PostgresOverviewService } from '@/application/workload/postgres/postgres-overview.service';
import { PostgresController } from '@/application/workload/postgres/postgres.controller';
import { PostgresWorkloadService } from '@/application/workload/postgres/postgres.service';
import { S3BucketObjectsController } from '@/application/workload/s3-bucket/s3-bucket-objects.controller';
import { S3BucketObjectsService } from '@/application/workload/s3-bucket/s3-bucket-objects.service';
import { S3BucketWorkloadService } from '@/application/workload/s3-bucket/s3-bucket.service';
import { StaticReleasesController } from '@/application/workload/static/static-releases.controller';
import { StaticWorkloadService } from '@/application/workload/static/static-workload.service';
import { WorkloadInstancesService } from '@/application/workload/instances/workload-instances.service';
import { WorkloadEventsService } from '@/application/workload/observer/workload-events.service';
import { WorkloadObserverService } from '@/application/workload/observer/workload-observer.service';
import { WorkloadSnapshotStore } from '@/application/workload/observer/workload-snapshot.store';
import { WorkloadStatusService } from '@/application/workload/observer/workload-status.service';
import { WorkloadTerminalService } from '@/application/workload/terminal/workload-terminal.service';
import { WorkloadController } from '@/application/workload/workload.controller';
import { WorkloadService } from '@/application/workload/workload.service';
import { WorkloadStatusDeriverRegistry } from '@/application/workload/workload-status-deriver.registry';
import { WorkloadTypeRegistry } from '@/application/workload/workload-type.registry';
import { WorkloadTypeResolver } from '@/application/workload/workload-type.resolver';
import { WorkloadVersionService } from '@/application/workload/workload-version.service';
import { SeaweedfsFilerClient } from '@/vendor/seaweedfs/seaweedfs-filer.client';
import { S3StorageClient } from '@/vendor/s3/s3.client';
import { TraefikClient } from '@/vendor/traefik/traefik.client';
import { GithubClient } from '@/vendor/github/github.client';
import { VictoriaLogsClient } from '@/vendor/victorialogs/victorialogs.client';
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
    AuditLogController,
    AuthController,
    GithubController,
    HealthController,
    MarketplaceController,
    LogsController,
    MetricsController,
    NodeController,
    PlatformUpdateController,
    ProjectController,
    StorageClassController,
    StorageBenchmarkController,
    SystemController,
    WorkloadController,
    S3BucketObjectsController,
    StaticReleasesController,
    PostgresController,
  ],
  providers: [
    AuditLogService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    PasswordAttemptLimiter,
    MarketplaceService,
    MarketplaceDeployService,
    GithubClient,
    GithubService,
    NodeService,
    NodeDrainService,
    NodeJoinService,
    NodeOperationStore,
    { provide: SshConnector, useClass: Ssh2Connector },
    PlatformReleaseService,
    PlatformUpdateService,
    PlatformVersionService,
    ProjectService,
    ProjectDnsService,
    ProjectIsolationService,
    StorageClassService,
    StorageBenchmarkService,
    ControlPlaneDnsService,
    ControlPlaneRoutingService,
    SystemService,
    SystemStatusService,
    DockerWorkloadStatusDeriver,
    DockerWorkloadService,
    DockerWorkloadNetworkService,
    S3BucketWorkloadService,
    PostgresWorkloadService,
    PostgresOverviewService,
    PostgresAccessService,
    PostgresBackupService,
    GithubWorkloadService,
    StaticWorkloadService,
    S3BucketObjectsService,
    SeaweedfsFilerClient,
    S3StorageClient,
    TraefikClient,
    VictoriaMetricsClient,
    MetricsService,
    VictoriaLogsClient,
    LogsService,
    WorkloadStatusDeriverRegistry,
    WorkloadEventsService,
    WorkloadInstancesService,
    WorkloadTerminalService,
    WorkloadSnapshotStore,
    WorkloadStatusService,
    WorkloadObserverService,
    WorkloadTypeRegistry,
    WorkloadTypeResolver,
    WorkloadVersionService,
    WorkloadService,
  ],
})
export class ApplicationModule {}
