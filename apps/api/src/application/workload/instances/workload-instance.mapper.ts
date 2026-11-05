import type { V1Pod } from '@kubernetes/client-node';
import type {
  WorkloadInstance,
  WorkloadInstanceStatus,
} from '@acceleratio/shared';
import { parseQuantity } from '@/application/metrics/metrics-query';
import { FAILURE_REASONS } from '../docker/docker-workload.status';
import { WORKLOAD_VERSION_ANNOTATION } from '../docker/docker-workload.manifests';

/** Live usage of one instance, keyed by pod name in the query results. */
export interface InstanceUsage {
  cpu_cores: number | null;
  memory_bytes: number | null;
}

const STARTING_REASONS = new Set(['ContainerCreating', 'PodInitializing']);

interface DerivedInstanceStatus {
  status: WorkloadInstanceStatus;
  status_reason: string | null;
  status_message: string | null;
}

const trimmed = (value: string | undefined): string | null =>
  value?.trim() || null;

const toIso = (value: Date | string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const isReady = (pod: V1Pod): boolean =>
  pod.status?.conditions?.some(
    (condition) => condition.type === 'Ready' && condition.status === 'True',
  ) ?? false;

const containerStatuses = (pod: V1Pod) => [
  ...(pod.status?.initContainerStatuses ?? []),
  ...(pod.status?.containerStatuses ?? []),
];

/** A waiting or terminated container state that means the instance broke. */
const containerFailure = (pod: V1Pod): DerivedInstanceStatus | undefined => {
  for (const status of containerStatuses(pod)) {
    const waiting = status.state?.waiting;

    if (waiting?.reason !== undefined && FAILURE_REASONS.has(waiting.reason)) {
      return {
        status: 'failed',
        status_reason: waiting.reason,
        status_message: trimmed(waiting.message),
      };
    }

    const terminated = status.state?.terminated;

    if (terminated?.reason === 'OOMKilled') {
      return {
        status: 'failed',
        status_reason: 'OOMKilled',
        status_message: trimmed(terminated.message),
      };
    }
  }

  return undefined;
};

const schedulingFailure = (pod: V1Pod): DerivedInstanceStatus | undefined => {
  const scheduled = pod.status?.conditions?.find(
    (condition) => condition.type === 'PodScheduled',
  );

  if (scheduled?.status === 'False' && scheduled.reason === 'Unschedulable') {
    return {
      status: 'pending',
      status_reason: 'Unschedulable',
      status_message: trimmed(scheduled.message),
    };
  }

  return undefined;
};

const waitingReason = (pod: V1Pod): string | undefined =>
  containerStatuses(pod).find((status) => status.state?.waiting?.reason)?.state
    ?.waiting?.reason;

/**
 * The instance status, in this order: being deleted, a failing container, a
 * pod that cannot be scheduled, a finished phase, still starting, running.
 */
export const deriveInstanceStatus = (pod: V1Pod): DerivedInstanceStatus => {
  if (pod.metadata?.deletionTimestamp) {
    return { status: 'terminating', status_reason: null, status_message: null };
  }

  const failure = containerFailure(pod) ?? schedulingFailure(pod);

  if (failure !== undefined) {
    return failure;
  }

  const phase = pod.status?.phase;

  if (phase === 'Succeeded') {
    return { status: 'completed', status_reason: null, status_message: null };
  }

  if (phase === 'Failed') {
    return {
      status: 'failed',
      status_reason: trimmed(pod.status?.reason),
      status_message: trimmed(pod.status?.message),
    };
  }

  if (phase === 'Pending') {
    const reason = waitingReason(pod);
    const scheduled = pod.status?.conditions?.some(
      (condition) =>
        condition.type === 'PodScheduled' && condition.status === 'True',
    );

    return {
      status:
        scheduled || (reason !== undefined && STARTING_REASONS.has(reason))
          ? 'starting'
          : 'pending',
      status_reason: reason ?? null,
      status_message: null,
    };
  }

  if (phase === 'Running') {
    return isReady(pod)
      ? { status: 'running', status_reason: null, status_message: null }
      : {
          status: 'starting',
          status_reason: waitingReason(pod) ?? null,
          status_message: null,
        };
  }

  return { status: 'unknown', status_reason: null, status_message: null };
};

/** Sum of the container limits, or null once any container has none. */
const sumLimits = (pod: V1Pod, resource: 'cpu' | 'memory'): number | null => {
  const containers = pod.spec?.containers ?? [];

  if (containers.length === 0) {
    return null;
  }

  let sum = 0;

  for (const container of containers) {
    const limit = parseQuantity(container.resources?.limits?.[resource]);

    if (limit === null) {
      return null;
    }

    sum += limit;
  }

  return sum;
};

export const toInstance = (
  pod: V1Pod,
  usage?: InstanceUsage,
): WorkloadInstance => ({
  name: pod.metadata?.name ?? '',
  ...deriveInstanceStatus(pod),
  ready: isReady(pod),
  restarts:
    pod.status?.containerStatuses?.reduce(
      (sum, status) => sum + (status.restartCount ?? 0),
      0,
    ) ?? 0,
  node: pod.spec?.nodeName ?? null,
  ip: pod.status?.podIP ?? null,
  version_id: pod.metadata?.annotations?.[WORKLOAD_VERSION_ANNOTATION] ?? null,
  created_at: toIso(pod.metadata?.creationTimestamp),
  started_at: toIso(pod.status?.startTime),
  cpu_cores: usage?.cpu_cores ?? null,
  cpu_limit_cores: sumLimits(pod, 'cpu'),
  memory_bytes: usage?.memory_bytes ?? null,
  memory_limit_bytes: sumLimits(pod, 'memory'),
});

/** Newest first, terminating instances last, name breaks ties. */
export const compareInstances = (
  left: WorkloadInstance,
  right: WorkloadInstance,
): number =>
  Number(left.status === 'terminating') -
    Number(right.status === 'terminating') ||
  (right.created_at ?? '').localeCompare(left.created_at ?? '') ||
  left.name.localeCompare(right.name);
