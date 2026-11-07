import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { V1PersistentVolumeClaim, V1Pod } from '@kubernetes/client-node';
import type {
  ClusterCapacity,
  MetricsRange,
  ProjectMetrics,
  ProjectMetricsSummary,
  Workload,
  WorkloadMetrics,
} from '@acceleratio/shared';
import { projectNamespace } from '@/common/naming';
import { ProjectService } from '@/application/project/project.service';
import { WorkloadService } from '@/application/workload/workload.service';
import { WORKLOAD_ID_LABEL } from '@/application/workload/docker/docker-workload.manifests';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { isActivePod, listNamespacePods } from '@/vendor/kubernetes/pods';
import {
  VictoriaMetricsClient,
  VictoriaMetricsUnavailableError,
} from '@/vendor/victoriametrics/victoriametrics.client';
import {
  createPodResolver,
  foldSignal,
  lastValue,
  lastValues,
  metricsWindow,
  parseQuantity,
  projectQueries,
  scalarValue,
  volumeQueries,
  type WorkloadRef,
} from './metrics-query';

export const METRICS_UNAVAILABLE_MESSAGE =
  'Metrics are unavailable: VictoriaMetrics is not reachable in the cluster';

type SignalName = keyof ProjectMetrics['series'];

interface PodUsage {
  ready: number;
  total: number;
  restarts: number;
  /** Null once any counted container runs without a limit. */
  cpuLimit: number | null;
  memoryLimit: number | null;
}

const emptyUsage = (): PodUsage => ({
  ready: 0,
  total: 0,
  restarts: 0,
  cpuLimit: 0,
  memoryLimit: 0,
});

const isReadyPod = (pod: V1Pod): boolean =>
  pod.status?.conditions?.some(
    (condition) => condition.type === 'Ready' && condition.status === 'True',
  ) ?? false;

const addLimit = (sum: number | null, limit: number | null): number | null =>
  sum === null || limit === null ? null : sum + limit;

/** Adds an active pod's readiness, restarts and container limits. */
const accumulatePod = (usage: PodUsage, pod: V1Pod) => {
  usage.total += 1;
  usage.ready += isReadyPod(pod) ? 1 : 0;
  usage.restarts +=
    pod.status?.containerStatuses?.reduce(
      (sum, status) => sum + (status.restartCount ?? 0),
      0,
    ) ?? 0;

  for (const container of pod.spec?.containers ?? []) {
    usage.cpuLimit = addLimit(
      usage.cpuLimit,
      parseQuantity(container.resources?.limits?.cpu),
    );
    usage.memoryLimit = addLimit(
      usage.memoryLimit,
      parseQuantity(container.resources?.limits?.memory),
    );
  }
};

/** A limit only means something when there is at least one pod. */
const limitOf = (usage: PodUsage, limit: number | null): number | null =>
  usage.total > 0 ? limit : null;

const pvcCapacity = (claim: V1PersistentVolumeClaim): number =>
  parseQuantity(
    claim.status?.capacity?.storage ?? claim.spec?.resources?.requests?.storage,
  ) ?? 0;

/**
 * Resource usage of a project's pods: VictoriaMetrics series for CPU, memory,
 * network and disk I/O, folded by workload, plus live readiness, restarts and
 * limits from the Kubernetes API.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private readonly projectService: ProjectService,
    private readonly workloadService: WorkloadService,
    private readonly kubernetes: KubernetesService,
    private readonly victoriaMetrics: VictoriaMetricsClient,
  ) {}

  async getProjectMetrics(
    projectId: string,
    range: MetricsRange,
    now = Date.now() / 1000,
  ): Promise<ProjectMetrics> {
    if (!(await this.projectService.exists(projectId))) {
      throw new NotFoundException('Project not found');
    }

    const namespace = projectNamespace(projectId);
    const window = metricsWindow(range, now);
    const queries = projectQueries(namespace, window.rateWindow);
    const volumes = volumeQueries(namespace);

    const [workloads, pods, claims, cluster, signals, diskUsed, diskCapacity] =
      await Promise.all([
        this.workloadService.list(projectId),
        this.listPods(namespace),
        this.listClaims(namespace),
        this.clusterCapacity(),
        this.querySignals(queries, window),
        this.queryScalar(volumes.used, window.end),
        this.queryScalar(volumes.capacity, window.end),
      ]);

    const refs: WorkloadRef[] = workloads.map((workload) => ({
      id: workload.id,
      name: workload.name,
      external_name: workload.external_name,
    }));

    const livePodWorkloads = new Map<string, string>();
    const usageByWorkload = new Map<string, PodUsage>();
    const projectUsage = emptyUsage();

    for (const pod of pods) {
      const name = pod.metadata?.name;
      const workloadId = pod.metadata?.labels?.[WORKLOAD_ID_LABEL];

      if (name && workloadId) {
        livePodWorkloads.set(name, workloadId);
      }

      if (!isActivePod(pod)) {
        continue;
      }

      accumulatePod(projectUsage, pod);

      if (workloadId) {
        let usage = usageByWorkload.get(workloadId);

        if (!usage) {
          usage = emptyUsage();
          usageByWorkload.set(workloadId, usage);
        }

        accumulatePod(usage, pod);
      }
    }

    const resolvePod = createPodResolver(refs, livePodWorkloads);
    const series = Object.fromEntries(
      Object.entries(signals).map(([name, result]) => [
        name,
        foldSignal(result, refs, resolvePod),
      ]),
    ) as ProjectMetrics['series'];

    const claimCapacity = claims.reduce(
      (sum, claim) => sum + pvcCapacity(claim),
      0,
    );

    const summary: ProjectMetricsSummary = {
      cpu_cores: lastValue(series.cpu_cores.total),
      cpu_limit_cores: limitOf(projectUsage, projectUsage.cpuLimit),
      memory_bytes: lastValue(series.memory_bytes.total),
      memory_limit_bytes: limitOf(projectUsage, projectUsage.memoryLimit),
      disk_used_bytes: diskUsed,
      disk_capacity_bytes:
        diskCapacity ?? (claims.length > 0 ? claimCapacity : null),
      network_rx_bytes_per_second: lastValue(
        series.network_rx_bytes_per_second.total,
      ),
      network_tx_bytes_per_second: lastValue(
        series.network_tx_bytes_per_second.total,
      ),
      pods_ready: projectUsage.ready,
      pods_total: projectUsage.total,
      restarts: projectUsage.restarts,
    };

    return {
      range,
      start: window.start,
      end: window.end,
      step_seconds: window.step,
      cluster,
      summary,
      series,
      workloads: this.workloadMetrics(workloads, usageByWorkload, series),
    };
  }

  private workloadMetrics(
    workloads: Workload[],
    usageByWorkload: Map<string, PodUsage>,
    series: ProjectMetrics['series'],
  ): WorkloadMetrics[] {
    const cpu = lastValues(series.cpu_cores);
    const memory = lastValues(series.memory_bytes);
    const rx = lastValues(series.network_rx_bytes_per_second);
    const tx = lastValues(series.network_tx_bytes_per_second);

    return workloads.map((workload) => {
      const usage = usageByWorkload.get(workload.id) ?? emptyUsage();

      return {
        workload_id: workload.id,
        name: workload.name,
        type: workload.type,
        status: workload.status,
        pods_ready: usage.ready,
        pods_total: usage.total,
        restarts: usage.restarts,
        cpu_cores: cpu.get(workload.id) ?? null,
        cpu_limit_cores: limitOf(usage, usage.cpuLimit),
        memory_bytes: memory.get(workload.id) ?? null,
        memory_limit_bytes: limitOf(usage, usage.memoryLimit),
        network_rx_bytes_per_second: rx.get(workload.id) ?? null,
        network_tx_bytes_per_second: tx.get(workload.id) ?? null,
      };
    });
  }

  private async querySignals(
    queries: Record<SignalName, string>,
    window: { start: number; end: number; step: number },
  ) {
    try {
      const entries = await Promise.all(
        (Object.entries(queries) as [SignalName, string][]).map(
          async ([name, promql]) =>
            [
              name,
              await this.victoriaMetrics.queryRange(
                promql,
                window.start,
                window.end,
                window.step,
              ),
            ] as const,
        ),
      );

      return Object.fromEntries(entries) as Record<
        SignalName,
        Awaited<ReturnType<VictoriaMetricsClient['queryRange']>>
      >;
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  private async queryScalar(promql: string, time: number) {
    try {
      return scalarValue(await this.victoriaMetrics.query(promql, time));
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  private unavailable(error: unknown): Error {
    if (error instanceof VictoriaMetricsUnavailableError) {
      this.logger.warn(error.message);
      return new ServiceUnavailableException(METRICS_UNAVAILABLE_MESSAGE);
    }

    return error as Error;
  }

  /** Pods of the namespace; a project that never deployed has none. */
  private async listPods(namespace: string): Promise<V1Pod[]> {
    try {
      return await listNamespacePods(this.kubernetes, namespace);
    } catch (error) {
      return this.emptyWhenMissing(error, 'pods');
    }
  }

  private async listClaims(
    namespace: string,
  ): Promise<V1PersistentVolumeClaim[]> {
    try {
      const { items } =
        await this.kubernetes.coreV1.listNamespacedPersistentVolumeClaim({
          namespace,
        });

      return items;
    } catch (error) {
      return this.emptyWhenMissing(error, 'volume claims');
    }
  }

  private emptyWhenMissing<T>(error: unknown, what: string): T[] {
    if (getKubernetesStatusCode(error) === 404) {
      return [];
    }

    this.logger.warn(
      `Failed to list project ${what}: ${(error as Error).message}`,
    );
    throw new ServiceUnavailableException('Kubernetes API is unavailable');
  }

  /** Allocatable CPU and memory across the nodes, or null when unknown. */
  private async clusterCapacity(): Promise<ClusterCapacity | null> {
    try {
      const { items } = await this.kubernetes.coreV1.listNode();
      let cpu = 0;
      let memory = 0;

      for (const node of items) {
        const allocatable = node.status?.allocatable ?? node.status?.capacity;
        cpu += parseQuantity(allocatable?.cpu) ?? 0;
        memory += parseQuantity(allocatable?.memory) ?? 0;
      }

      return items.length > 0 ? { cpu_cores: cpu, memory_bytes: memory } : null;
    } catch (error) {
      this.logger.warn(
        `Failed to read node capacity: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
