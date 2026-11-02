import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import type { WorkloadStatus } from '@acceleratio/shared';

const FAILURE_REASONS = new Set([
  'ImagePullBackOff',
  'ErrImagePull',
  'InvalidImageName',
  'CrashLoopBackOff',
  'CreateContainerConfigError',
]);

const PROGRESS_DEADLINE_EXCEEDED = 'ProgressDeadlineExceeded';
const FALLBACK_PROGRESS_MESSAGE = 'Progress deadline exceeded';

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
  }

  return undefined;
};

const findPodFailure = (pods: V1Pod[]): string | undefined => {
  for (const pod of pods) {
    const failure = findContainerFailure(pod);

    if (failure !== undefined) {
      return failure;
    }
  }

  return undefined;
};

/**
 * Derives the workload status from the cluster as described in the plan:
 * a scaled-to-zero Deployment is stopped (even with failing pods), an
 * Available Deployment is running, a stalled rollout or a failing container
 * is failed, and anything else is still deploying.
 */
export const deriveStatus = (
  deployment: V1Deployment | undefined,
  pods: V1Pod[] = [],
): DerivedWorkloadStatus => {
  if (deployment === undefined) {
    return { status: 'draft', status_message: null };
  }

  if (deployment.spec?.replicas === 0) {
    return { status: 'stopped', status_message: null };
  }

  const conditions = deployment.status?.conditions ?? [];
  const available = conditions.find(
    (condition) => condition.type === 'Available',
  );

  if (available?.status === 'True') {
    return { status: 'running', status_message: null };
  }

  const progressing = conditions.find(
    (condition) => condition.type === 'Progressing',
  );

  if (
    progressing?.status === 'False' &&
    progressing.reason === PROGRESS_DEADLINE_EXCEEDED
  ) {
    return {
      status: 'failed',
      status_message: progressing.message?.trim() || FALLBACK_PROGRESS_MESSAGE,
    };
  }

  const podFailure = findPodFailure(pods);

  if (podFailure !== undefined) {
    return { status: 'failed', status_message: podFailure };
  }

  return { status: 'deploying', status_message: null };
};
