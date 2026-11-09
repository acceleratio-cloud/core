import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Workload } from '@acceleratio/shared';
import type { ProjectService } from '@/application/project/project.service';
import type { WorkloadService } from '@/application/workload/workload.service';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  VictoriaMetricsUnavailableError,
  type PromSeries,
  type VictoriaMetricsClient,
} from '@/vendor/victoriametrics/victoriametrics.client';
import {
  METRICS_UNAVAILABLE_MESSAGE,
  MetricsService,
} from '../metrics.service';
import { postgresQueries } from '../metrics-query';

// These pull the ESM-only Kubernetes client or the database; every instance
// here is faked.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('@/application/project/project.service', () => ({
  ProjectService: class ProjectService {},
}));
jest.mock('@/application/workload/workload.service', () => ({
  WorkloadService: class WorkloadService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const namespace = `project-${projectId}`;

const workload = (id: string, name: string): Workload =>
  ({
    id,
    name,
    type: 'docker',
    status: 'running',
    external_name: name,
  }) as Workload;

const pod = (
  name: string,
  workloadId: string | undefined,
  options: { ready?: boolean; restarts?: number; limits?: boolean } = {},
) => ({
  metadata: {
    name,
    labels: workloadId ? { 'acceleratio.io/workload-id': workloadId } : {},
  },
  spec: {
    containers: [
      {
        name: 'app',
        resources:
          options.limits === false
            ? {}
            : { limits: { cpu: '500m', memory: '256Mi' } },
      },
    ],
  },
  status: {
    phase: 'Running',
    conditions: [
      { type: 'Ready', status: options.ready === false ? 'False' : 'True' },
    ],
    containerStatuses: [{ restartCount: options.restarts ?? 0 }],
  },
});

const build = (
  overrides: {
    pods?: unknown[];
    queryRange?: (promql: string) => Promise<PromSeries[]>;
    exists?: boolean;
  } = {},
) => {
  const coreV1 = {
    listNamespacedPod: jest.fn().mockResolvedValue({
      items: overrides.pods ?? [
        pod('api-1-a', 'w-api', { restarts: 2 }),
        pod('api-1-b', 'w-api', { ready: false }),
      ],
    }),
    listNamespacedPersistentVolumeClaim: jest
      .fn()
      .mockResolvedValue({ items: [] }),
    listNode: jest.fn().mockResolvedValue({
      items: [{ status: { allocatable: { cpu: '4', memory: '8Gi' } } }],
    }),
  };
  const queryRange = jest.fn(
    overrides.queryRange ??
      ((promql: string) =>
        Promise.resolve<PromSeries[]>(
          promql.includes('container_cpu_usage_seconds_total')
            ? [
                { metric: { pod: 'api-1-a' }, values: [[60, '0.2']] },
                { metric: { pod: 'api-1-b' }, values: [[60, '0.1']] },
              ]
            : [],
        )),
  );
  const query = jest.fn().mockResolvedValue([]);
  const service = new MetricsService(
    {
      exists: jest.fn().mockResolvedValue(overrides.exists ?? true),
    } as unknown as ProjectService,
    {
      list: jest.fn().mockResolvedValue([workload('w-api', 'api')]),
    } as unknown as WorkloadService,
    { coreV1 } as unknown as KubernetesService,
    { queryRange, query } as unknown as VictoriaMetricsClient,
  );

  return { service, coreV1, queryRange };
};

describe('postgresQueries', () => {
  it('reads the per-pod scrape of the app database and leaves the exporter out', () => {
    const queries = postgresQueries('project-x', '60s');

    expect(queries.connections).toContain('job="kubernetes-pods"');
    expect(queries.connections).toContain(
      'application_name!="cnpg_metrics_exporter"',
    );
    expect(queries.transactions_per_second).toContain('datname="app"');
    expect(queries.cache_hit_ratio).toContain('blks_read');
  });
});

describe('MetricsService', () => {
  it('folds PostgreSQL exporter series per database and drops unknown pods', async () => {
    const { service } = build({
      queryRange: (promql) =>
        Promise.resolve<PromSeries[]>(
          promql.includes('cnpg_backends_total')
            ? [
                { metric: { pod: 'api-1-a' }, values: [[60, '3']] },
                { metric: { pod: 'stray-0' }, values: [[60, '9']] },
              ]
            : [],
        ),
    });

    const metrics = await service.getProjectMetrics(projectId, '1h', 3600);

    expect(metrics.postgres.connections).toEqual([
      { key: 'w-api', label: 'api', points: [[60, 3]] },
    ]);
    expect(metrics.postgres.transactions_per_second).toEqual([]);
  });

  it('folds series by workload and adds live pod state', async () => {
    const { service, coreV1, queryRange } = build();

    const metrics = await service.getProjectMetrics(projectId, '1h', 3600);

    expect(coreV1.listNamespacedPod).toHaveBeenCalledWith({ namespace });
    // Six resource signals and four PostgreSQL ones.
    expect(queryRange).toHaveBeenCalledTimes(10);
    expect(metrics.summary).toMatchObject({
      cpu_cores: expect.closeTo(0.3) as number,
      cpu_limit_cores: 1,
      memory_limit_bytes: 512 * 1024 ** 2,
      pods_ready: 1,
      pods_total: 2,
      restarts: 2,
      disk_capacity_bytes: null,
    });
    expect(metrics.cluster).toEqual({
      cpu_cores: 4,
      memory_bytes: 8 * 1024 ** 3,
    });
    expect(metrics.series.cpu_cores.by_workload).toHaveLength(1);
    expect(metrics.workloads[0]).toMatchObject({
      workload_id: 'w-api',
      pods_ready: 1,
      pods_total: 2,
      cpu_cores: expect.closeTo(0.3) as number,
    });
  });

  it('reports no limit when a container runs without one', async () => {
    const { service } = build({
      pods: [pod('api-1-a', 'w-api', { limits: false })],
    });

    const metrics = await service.getProjectMetrics(projectId, '1h', 3600);

    expect(metrics.summary.cpu_limit_cores).toBeNull();
    expect(metrics.workloads[0].memory_limit_bytes).toBeNull();
  });

  it('returns 404 for an unknown project', async () => {
    const { service } = build({ exists: false });

    await expect(
      service.getProjectMetrics(projectId, '1h'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 503 when VictoriaMetrics is unreachable', async () => {
    const { service } = build({
      queryRange: () =>
        Promise.reject(new VictoriaMetricsUnavailableError('connect refused')),
    });

    await expect(service.getProjectMetrics(projectId, '1h')).rejects.toEqual(
      new ServiceUnavailableException(METRICS_UNAVAILABLE_MESSAGE),
    );
  });
});
