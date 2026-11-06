import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import type { WorkloadStatus } from '@acceleratio/shared';

export const FAILURE_REASONS = new Set([
  'ImagePullBackOff',
  'ErrImagePull',
  'ErrImageNeverPull',
  'InvalidImageName',
  'CrashLoopBackOff',
  'CreateContainerConfigError',
  'CreateContainerError',
  'RunContainerError',
]);

const PROGRESS_DEADLINE_EXCEEDED = 'ProgressDeadlineExceeded';
const FALLBACK_PROGRESS_MESSAGE = 'Progress deadline exceeded';
const REPLICA_FAILURE = 'ReplicaFailure';
const FALLBACK_REPLICA_FAILURE_MESSAGE = 'Replica creation failed';
const POD_SCHEDULED = 'PodScheduled';
const UNSCHEDULABLE = 'Unschedulable';
const OOM_KILLED = 'OOMKilled';
// `spec.replicas` unset means the Deployment controller defaults it to one.
const IMPLICIT_REPLICAS = 1;

export interface DerivedWorkloadStatus {
  status: WorkloadStatus;
  status_message: string | null;
}

const withDetail = (reason: string, detail: string | undefined) => {
  const message = detail?.trim();

  return message ? `${reason}: ${message}` : reason;
};

const findContainerFailure = (pod: V1Pod): string | undefined => {
  const statuses = [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
  ];

  for (const status of statuses) {
    const waiting = status.state?.waiting;
    const reason = waiting?.reason;

    if (reason !== undefined && FAILURE_REASONS.has(reason)) {
      return withDetail(reason, waiting?.message);
    }

    // Only the current termination counts. A container that has restarted and
    // is running again keeps the OOM in `lastState`, which is history.
    const terminated = status.state?.terminated;

    if (terminated?.reason === OOM_KILLED) {
      return withDetail(OOM_KILLED, terminated.message);
    }
  }

  return undefined;
};

const findSchedulingFailure = (pod: V1Pod): string | undefined => {
  const scheduled = (pod.status?.conditions ?? []).find(
    (condition) => condition.type === POD_SCHEDULED,
  );

  if (scheduled?.status === 'False' && scheduled.reason === UNSCHEDULABLE) {
    return withDetail(UNSCHEDULABLE, scheduled.message);
  }

  return undefined;
};

const findPodFailure = (pods: V1Pod[]): string | undefined => {
  for (const pod of pods) {
    const failure = findContainerFailure(pod) ?? findSchedulingFailure(pod);

    if (failure !== undefined) {
      return failure;
    }
  }

  return undefined;
};

const findDeploymentFailure = (
  deployment: V1Deployment,
): string | undefined => {
  const conditions = deployment.status?.conditions ?? [];
  const progressing = conditions.find(
    (condition) => condition.type === 'Progressing',
  );

  if (
    progressing?.status === 'False' &&
    progressing.reason === PROGRESS_DEADLINE_EXCEEDED
  ) {
    return progressing.message?.trim() || FALLBACK_PROGRESS_MESSAGE;
  }

  const replicaFailure = conditions.find(
    (condition) =>
      condition.type === REPLICA_FAILURE && condition.status === 'True',
  );

  if (replicaFailure !== undefined) {
    return replicaFailure.message?.trim() || FALLBACK_REPLICA_FAILURE_MESSAGE;
  }

  return undefined;
};

const isAvailable = (deployment: V1Deployment, replicas: number): boolean => {
  const conditions = deployment.status?.conditions ?? [];
  const available = conditions.find(
    (condition) => condition.type === 'Available',
  );

  return (
    available?.status === 'True' &&
    deployment.status?.updatedReplicas === replicas &&
    (deployment.status?.unavailableReplicas ?? 0) === 0
  );
};

/**
 * Derives the workload status from the cluster, in this order: a
 * scaled-to-zero Deployment is stopped (even with failing pods), a stale
 * observedGeneration is deploying, a stalled rollout or replica failure is
 * failed, a failing pod is failed, a fully available rollout is running, and
 * anything else is still deploying.
 */
export const deriveStatus = (
  deployment: V1Deployment | undefined,
  pods: V1Pod[] = [],
): DerivedWorkloadStatus => {
  if (deployment === undefined) {
    return { status: 'draft', status_message: null };
  }

  const replicas = deployment.spec?.replicas ?? IMPLICIT_REPLICAS;

  if (replicas === 0) {
    return { status: 'stopped', status_message: null };
  }

  const generation = deployment.metadata?.generation;
  const observedGeneration = deployment.status?.observedGeneration;

  if (
    typeof generation === 'number' &&
    typeof observedGeneration === 'number' &&
    observedGeneration < generation
  ) {
    return { status: 'deploying', status_message: null };
  }

  const deploymentFailure = findDeploymentFailure(deployment);

  if (deploymentFailure !== undefined) {
    return { status: 'failed', status_message: deploymentFailure };
  }

  const podFailure = findPodFailure(pods);

  if (podFailure !== undefined) {
    return { status: 'failed', status_message: podFailure };
  }

  if (isAvailable(deployment, replicas)) {
    return { status: 'running', status_message: null };
  }

  return { status: 'deploying', status_message: null };
};

/** Kubelet events that mean a volume of the pod cannot be mounted. */
export const MOUNT_FAILURE_REASONS = new Set([
  'FailedMount',
  'FailedAttachVolume',
]);
/**
 * How long a scheduled pod may sit in ContainerCreating before its events
 * are read. Mounts can fail once and then succeed, so only a lasting failure
 * counts.
 */
export const MOUNT_GRACE_MS = 60_000;
const CONTAINER_CREATING = 'ContainerCreating';

/**
 * Pods with a volume claim that were scheduled more than the grace period
 * ago and still have no container running. A mount failure only shows in
 * their events, which the caller reads.
 */
export const podsStuckMounting = (pods: V1Pod[], now: number): V1Pod[] =>
  pods.filter((pod) => {
    if (
      pod.metadata?.deletionTimestamp ||
      !(pod.spec?.volumes ?? []).some((volume) => volume.persistentVolumeClaim)
    ) {
      return false;
    }

    const scheduled = (pod.status?.conditions ?? []).find(
      (condition) => condition.type === POD_SCHEDULED,
    );
    const scheduledAt = scheduled?.lastTransitionTime
      ? new Date(scheduled.lastTransitionTime).getTime()
      : Number.NaN;

    if (
      scheduled?.status !== 'True' ||
      !Number.isFinite(scheduledAt) ||
      now - scheduledAt < MOUNT_GRACE_MS
    ) {
      return false;
    }

    const statuses = pod.status?.containerStatuses ?? [];

    return (
      statuses.length === 0 ||
      statuses.every(
        (status) => status.state?.waiting?.reason === CONTAINER_CREATING,
      )
    );
  });
