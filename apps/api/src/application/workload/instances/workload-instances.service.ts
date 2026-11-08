import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { V1Pod } from '@kubernetes/client-node';
import {
  isContainerWorkload,
  type WorkloadInstancesSnapshot,
} from '@acceleratio/shared';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  from,
  interval,
  finalize,
  map,
  merge,
  of,
  ReplaySubject,
  share,
  type Observable,
} from 'rxjs';
import { projectNamespace } from '@/common/naming';
import {
  instanceQueries,
  valuesByPod,
} from '@/application/metrics/metrics-query';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  VictoriaMetricsClient,
  VictoriaMetricsUnavailableError,
} from '@/vendor/victoriametrics/victoriametrics.client';
import { WORKLOAD_ID_LABEL } from '../docker/docker-workload.manifests';
import { HEARTBEAT_INTERVAL_MS } from '../observer/workload-events.service';
import { WorkloadSnapshotStore } from '../observer/workload-snapshot.store';
import { WorkloadTypeResolver } from '../workload-type.resolver';
import {
  compareInstances,
  toInstance,
  type InstanceUsage,
} from './workload-instance.mapper';

/** How often usage is refreshed; pod changes push sooner. */
export const INSTANCES_REFRESH_MS = 5_000;
/** Collapses the burst of watch events one rollout step produces. */
export const POD_CHANGE_DEBOUNCE_MS = 250;

const HEARTBEAT: MessageEvent = {
  type: 'heartbeat',
  data: { type: 'heartbeat' },
};

interface Usage {
  available: boolean;
  byPod: Map<string, InstanceUsage>;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A snapshot without its clock, so identical frames can be skipped. */
const frameKey = (snapshot: WorkloadInstancesSnapshot): string =>
  JSON.stringify({ ...snapshot, observed_at: undefined });

/**
 * The running copies (Pods) of a Docker workload with their live CPU and
 * memory. Pods come from the observer's in-memory snapshot when it holds the
 * workload and from the Kubernetes API otherwise; usage comes from
 * VictoriaMetrics and degrades to unknown when it is unreachable.
 */
@Injectable()
export class WorkloadInstancesService {
  private readonly logger = new Logger(WorkloadInstancesService.name);
  /** One refresh loop per workload, shared by everyone watching it. */
  private readonly frames = new Map<
    string,
    Observable<WorkloadInstancesSnapshot>
  >();

  constructor(
    private readonly resolver: WorkloadTypeResolver,
    private readonly store: WorkloadSnapshotStore,
    private readonly kubernetes: KubernetesService,
    private readonly victoriaMetrics: VictoriaMetricsClient,
  ) {}

  /** Throws 404 for an unknown workload and 400 for a non-Docker one. */
  async assertDocker(projectId: string, workloadId: string): Promise<void> {
    const type = await this.resolver.resolve(projectId, workloadId);

    if (!isContainerWorkload(type)) {
      throw new BadRequestException('Only Docker services have instances');
    }
  }

  async get(
    projectId: string,
    workloadId: string,
  ): Promise<WorkloadInstancesSnapshot> {
    await this.assertDocker(projectId, workloadId);

    return this.snapshot(projectId, workloadId);
  }

  /**
   * One frame now, then one whenever the workload's Pods change or the usage
   * refresh ticks, skipping frames identical to the last one. A failed frame
   * is logged and the stream keeps going. Viewers of the same workload share
   * one refresh loop, so more viewers do not mean more cluster and metrics
   * queries; a viewer that joins late gets the latest frame at once.
   */
  stream(projectId: string, workloadId: string): Observable<MessageEvent> {
    const frames = this.sharedFrames(projectId, workloadId).pipe(
      map((snapshot): MessageEvent => ({ data: snapshot })),
    );
    const heartbeat = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map(() => HEARTBEAT),
    );

    return merge(frames, heartbeat);
  }

  private sharedFrames(
    projectId: string,
    workloadId: string,
  ): Observable<WorkloadInstancesSnapshot> {
    const key = `${projectId}/${workloadId}`;
    const existing = this.frames.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const triggers = merge(
      of(undefined),
      this.store
        .podChangesOf(workloadId)
        .pipe(debounceTime(POD_CHANGE_DEBOUNCE_MS)),
      interval(INSTANCES_REFRESH_MS),
    );
    const frames = triggers.pipe(
      exhaustMap(() =>
        from(this.snapshot(projectId, workloadId)).pipe(
          catchError((error: unknown) => {
            this.logger.warn(
              `Could not read instances of workload ${workloadId}: ${describeError(error)}`,
            );

            return EMPTY;
          }),
        ),
      ),
      distinctUntilChanged((left, right) => frameKey(left) === frameKey(right)),
      // Runs when the last viewer leaves, before the loop is torn down.
      finalize(() => this.frames.delete(key)),
      share({
        connector: () => new ReplaySubject<WorkloadInstancesSnapshot>(1),
        resetOnRefCountZero: true,
      }),
    );

    this.frames.set(key, frames);

    return frames;
  }

  async snapshot(
    projectId: string,
    workloadId: string,
  ): Promise<WorkloadInstancesSnapshot> {
    const namespace = projectNamespace(projectId);
    const pods = await this.pods(namespace, workloadId);
    const usage = await this.usage(
      namespace,
      pods
        .map((pod) => pod.metadata?.name)
        .filter((name): name is string => Boolean(name)),
    );

    const instances = pods
      .map((pod) => toInstance(pod, usage.byPod.get(pod.metadata?.name ?? '')))
      .sort(compareInstances);

    return {
      workload_id: workloadId,
      instances,
      metrics_available: usage.available,
      observed_at: new Date().toISOString(),
    };
  }

  private async pods(namespace: string, workloadId: string): Promise<V1Pod[]> {
    const observed = this.store.get(workloadId);

    if (observed !== undefined) {
      return observed.pods;
    }

    try {
      const { items } = await this.kubernetes.coreV1.listNamespacedPod({
        namespace,
        labelSelector: `${WORKLOAD_ID_LABEL}=${workloadId}`,
      });

      return items;
    } catch (error) {
      // A project that never deployed has no namespace, and so no instances.
      if (getKubernetesStatusCode(error) === 404) {
        return [];
      }

      this.logger.warn(`Failed to list instances: ${describeError(error)}`);
      throw new ServiceUnavailableException('Kubernetes API is unavailable');
    }
  }

  private async usage(namespace: string, pods: string[]): Promise<Usage> {
    if (pods.length === 0) {
      return { available: true, byPod: new Map() };
    }

    const queries = instanceQueries(namespace, pods);
    const now = Date.now() / 1000;

    try {
      const [cpu, memory] = await Promise.all([
        this.victoriaMetrics.query(queries.cpu_cores, now),
        this.victoriaMetrics.query(queries.memory_bytes, now),
      ]);
      const cpuByPod = valuesByPod(cpu);
      const memoryByPod = valuesByPod(memory);

      return {
        available: true,
        byPod: new Map(
          pods.map((pod) => [
            pod,
            {
              cpu_cores: cpuByPod.get(pod) ?? null,
              memory_bytes: memoryByPod.get(pod) ?? null,
            },
          ]),
        ),
      };
    } catch (error) {
      if (error instanceof VictoriaMetricsUnavailableError) {
        return { available: false, byPod: new Map() };
      }

      throw error;
    }
  }
}
