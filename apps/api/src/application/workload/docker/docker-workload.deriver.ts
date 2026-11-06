import { Injectable, Logger } from '@nestjs/common';
import type { CoreV1Event, V1Pod } from '@kubernetes/client-node';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { DerivedWorkloadStatus } from './docker-workload.status';
import {
  deriveStatus,
  MOUNT_FAILURE_REASONS,
  podsStuckMounting,
} from './docker-workload.status';
import type {
  WorkloadStatusDeriver,
  WorkloadStatusSnapshot,
} from '../workload-status-deriver';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const eventTime = (event: CoreV1Event): number =>
  new Date(
    event.lastTimestamp ??
      event.eventTime ??
      event.firstTimestamp ??
      event.metadata?.creationTimestamp ??
      0,
  ).getTime();

/**
 * Docker workloads are plain Deployments, so the status comes from
 * `deriveStatus`. One case needs more than the pods: a volume that cannot be
 * mounted keeps a pod in ContainerCreating and says why only in its events,
 * so a rollout stuck there is read from them instead of waiting out the
 * progress deadline.
 */
@Injectable()
export class DockerWorkloadStatusDeriver implements WorkloadStatusDeriver {
  readonly type = 'docker' as const;

  private readonly logger = new Logger(DockerWorkloadStatusDeriver.name);

  constructor(private readonly kubernetes: KubernetesService) {}

  async derive(
    snapshot: WorkloadStatusSnapshot,
  ): Promise<DerivedWorkloadStatus> {
    const derived = deriveStatus(snapshot.deployment, snapshot.pods);

    if (derived.status !== 'deploying') {
      return derived;
    }

    for (const pod of podsStuckMounting(snapshot.pods, Date.now())) {
      const failure = await this.mountFailure(pod);

      if (failure !== undefined) {
        return { status: 'failed', status_message: failure };
      }
    }

    return derived;
  }

  /** The latest mount failure event of a pod; unknown when events fail. */
  private async mountFailure(pod: V1Pod): Promise<string | undefined> {
    const name = pod.metadata?.name;
    const namespace = pod.metadata?.namespace;

    if (!name || !namespace) {
      return undefined;
    }

    let events: CoreV1Event[];

    try {
      events = (
        await this.kubernetes.coreV1.listNamespacedEvent({
          namespace,
          fieldSelector: `involvedObject.kind=Pod,involvedObject.name=${name}`,
        })
      ).items;
    } catch (error) {
      this.logger.warn(
        `Could not read events of pod ${namespace}/${name}: ${describeError(error)}`,
      );

      return undefined;
    }

    const latest = events
      .filter((event) => MOUNT_FAILURE_REASONS.has(event.reason ?? ''))
      .sort((left, right) => eventTime(right) - eventTime(left))[0];

    if (latest === undefined) {
      return undefined;
    }

    const message = latest.message?.trim();

    return message ? `${latest.reason}: ${message}` : latest.reason;
  }
}
