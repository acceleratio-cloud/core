import type { V1Container, V1Deployment } from '@kubernetes/client-node';
import type { DockerWorkloadConfig } from '@acceleratio/shared';
import { projectNamespace } from '@/common/naming';

export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY_VALUE = 'acceleratio';
export const PROJECT_ID_LABEL = 'acceleratio.io/project-id';
export const WORKLOAD_ID_LABEL = 'acceleratio.io/workload-id';
export const WORKLOAD_NAME_ANNOTATION = 'acceleratio.io/workload-name';
export const RESTARTED_AT_ANNOTATION = 'acceleratio.io/restarted-at';

export const CONTAINER_NAME = 'main';
export const DEFAULT_REPLICAS = 1;
export const PROGRESS_DEADLINE_SECONDS = 300;
export const REVISION_HISTORY_LIMIT = 3;
export const TERMINATION_GRACE_PERIOD_SECONDS = 30;
export const CPU_REQUEST = '100m';
export const MEMORY_REQUEST = '128Mi';
export const CPU_LIMIT = '1';
export const MEMORY_LIMIT = '1Gi';
export const LATEST_TAG = 'latest';
export const ALWAYS_PULL_POLICY = 'Always';
export const IF_NOT_PRESENT_PULL_POLICY = 'IfNotPresent';

export interface WorkloadManifestInput {
  id: string;
  project_id: string;
  name: string;
  external_name: string;
  config: DockerWorkloadConfig;
}

export interface DeploymentOptions {
  replicas?: number;
  restartedAt?: string;
  resourceVersion?: string;
}

/**
 * A missing tag means the registry falls back to `latest`, and `latest` is
 * mutable, so both must force a pull. A colon in the registry host
 * (`registry:5000/image`) belongs to the host, not the tag, so only the last
 * path segment is inspected. A digest is immutable and uses the default policy.
 */
export const imagePullPolicy = (image: string): string => {
  if (image.includes('@')) {
    return IF_NOT_PRESENT_PULL_POLICY;
  }

  const lastSegment = image.slice(image.lastIndexOf('/') + 1);
  const tagSeparator = lastSegment.lastIndexOf(':');

  if (tagSeparator === -1) {
    return ALWAYS_PULL_POLICY;
  }

  const tag = lastSegment.slice(tagSeparator + 1);

  return tag === LATEST_TAG || tag === ''
    ? ALWAYS_PULL_POLICY
    : IF_NOT_PRESENT_PULL_POLICY;
};

const workloadLabels = (
  input: WorkloadManifestInput,
): Record<string, string> => ({
  [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  [PROJECT_ID_LABEL]: input.project_id,
  [WORKLOAD_ID_LABEL]: input.id,
});

const workloadMetadata = (input: WorkloadManifestInput) => ({
  name: input.external_name,
  namespace: projectNamespace(input.project_id),
  labels: workloadLabels(input),
  annotations: { [WORKLOAD_NAME_ANNOTATION]: input.name },
});

export const buildDeployment = (
  input: WorkloadManifestInput,
  options: DeploymentOptions = {},
): V1Deployment => {
  const container: V1Container = {
    name: CONTAINER_NAME,
    image: input.config.docker_image,
    imagePullPolicy: imagePullPolicy(input.config.docker_image),
    resources: {
      requests: { cpu: CPU_REQUEST, memory: MEMORY_REQUEST },
      limits: { cpu: CPU_LIMIT, memory: MEMORY_LIMIT },
    },
  };

  const annotations: Record<string, string> = {
    [WORKLOAD_NAME_ANNOTATION]: input.name,
  };

  if (options.restartedAt !== undefined) {
    annotations[RESTARTED_AT_ANNOTATION] = options.restartedAt;
  }

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      ...workloadMetadata(input),
      ...(options.resourceVersion !== undefined
        ? { resourceVersion: options.resourceVersion }
        : {}),
    },
    spec: {
      replicas: options.replicas ?? DEFAULT_REPLICAS,
      progressDeadlineSeconds: PROGRESS_DEADLINE_SECONDS,
      revisionHistoryLimit: REVISION_HISTORY_LIMIT,
      selector: {
        matchLabels: { [WORKLOAD_ID_LABEL]: input.id },
      },
      template: {
        metadata: {
          labels: {
            [PROJECT_ID_LABEL]: input.project_id,
            [WORKLOAD_ID_LABEL]: input.id,
          },
          annotations,
        },
        spec: {
          terminationGracePeriodSeconds: TERMINATION_GRACE_PERIOD_SECONDS,
          containers: [container],
        },
      },
    },
  };
};
