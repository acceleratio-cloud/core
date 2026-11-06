import type {
  V1Container,
  V1Deployment,
  V1ResourceRequirements,
  V1Secret,
} from '@kubernetes/client-node';
import type { DockerWorkloadConfig } from '@acceleratio/shared';
import { projectNamespace } from '@/common/naming';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  DEFAULT_REPLICAS,
} from './docker-workload.config';

export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY_VALUE = 'acceleratio';
export const PROJECT_ID_LABEL = 'acceleratio.io/project-id';
export const WORKLOAD_ID_LABEL = 'acceleratio.io/workload-id';
export const WORKLOAD_NAME_ANNOTATION = 'acceleratio.io/workload-name';
export const RESTARTED_AT_ANNOTATION = 'acceleratio.io/restarted-at';
export const WORKLOAD_VERSION_ANNOTATION = 'acceleratio.io/workload-version-id';

export const CONTAINER_NAME = 'main';
export const PROGRESS_DEADLINE_SECONDS = 300;
export const REVISION_HISTORY_LIMIT = 3;
export const TERMINATION_GRACE_PERIOD_SECONDS = 30;
/** Requests in millicores and MiB; lowered to the limit when it is smaller. */
export const CPU_REQUEST_MILLICORES = 100;
export const MEMORY_REQUEST_MIB = 128;
export const CPU_REQUEST = '100m';
export const MEMORY_REQUEST = '128Mi';
export const CPU_LIMIT = '1';
export const MEMORY_LIMIT = '1Gi';
export const LATEST_TAG = 'latest';
export const ALWAYS_PULL_POLICY = 'Always';
export const IF_NOT_PRESENT_PULL_POLICY = 'IfNotPresent';
export const ENV_SECRET_INFIX = '-env-';

/**
 * Prefix shared by every env Secret of a service, so they can be told apart
 * from other Secrets that carry the workload label.
 */
export const envSecretPrefix = (externalName: string): string =>
  `${externalName}${ENV_SECRET_INFIX}`;

/**
 * Secret that holds the environment variables of one version. Each version
 * gets its own, so pods of the previous version keep the values they started
 * with while a rollout runs, and a failed deploy never changes them. External
 * names leave room for the suffix within the 253-character Secret name limit.
 */
export const envSecretName = (
  externalName: string,
  versionId: string,
): string => `${envSecretPrefix(externalName)}${versionId}`;

/** The env Secret of the version an input applies. */
export const envSecretNameOf = (input: WorkloadManifestInput): string => {
  if (input.version_id === undefined) {
    throw new Error('Environment variables need the version being applied');
  }

  return envSecretName(input.external_name, input.version_id);
};

export interface WorkloadManifestInput {
  id: string;
  project_id: string;
  name: string;
  external_name: string;
  config: DockerWorkloadConfig;
  /**
   * Version the pod template runs. It changes the template hash, so applying
   * another version always rolls the pods, even to an identical config.
   */
  version_id?: string;
}

export interface DeploymentOptions {
  /** Overrides the config's pod count. */
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

/**
 * Whole cores and whole GiB keep their short form (`1`, `1Gi`), so the
 * defaults render exactly as they did before limits became configurable and
 * an unchanged pod template does not roll.
 */
export const cpuQuantity = (millicores: number): string =>
  millicores % 1000 === 0 ? String(millicores / 1000) : `${millicores}m`;

export const memoryQuantity = (mib: number): string =>
  mib % 1024 === 0 ? `${mib / 1024}Gi` : `${mib}Mi`;

/**
 * A null limit leaves that resource unlimited; the request stays at its
 * default so the scheduler still reserves a baseline.
 */
const containerResources = (
  config: DockerWorkloadConfig,
): V1ResourceRequirements => {
  const cpuLimit =
    config.cpu_max === null
      ? null
      : Math.round((config.cpu_max ?? DEFAULT_CPU_MAX) * 1000);
  const memoryLimit =
    config.ram_max === null ? null : (config.ram_max ?? DEFAULT_RAM_MAX);
  const limits: Record<string, string> = {};

  if (cpuLimit !== null) {
    limits.cpu = cpuQuantity(cpuLimit);
  }

  if (memoryLimit !== null) {
    limits.memory = memoryQuantity(memoryLimit);
  }

  return {
    requests: {
      cpu: cpuQuantity(Math.min(CPU_REQUEST_MILLICORES, cpuLimit ?? Infinity)),
      memory: memoryQuantity(
        Math.min(MEMORY_REQUEST_MIB, memoryLimit ?? Infinity),
      ),
    },
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
  };
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
    resources: containerResources(input.config),
  };

  // Docker's ENTRYPOINT is the Kubernetes `command`, and CMD is `args`.
  if (input.config.entrypoint?.length) {
    container.command = [...input.config.entrypoint];
  }

  if (input.config.command?.length) {
    container.args = [...input.config.command];
  }

  // Without variables the template stays as it was, so services that never
  // set any do not roll when this field ships.
  if (input.config.env?.length) {
    container.envFrom = [{ secretRef: { name: envSecretNameOf(input) } }];
  }

  const annotations: Record<string, string> = {
    [WORKLOAD_NAME_ANNOTATION]: input.name,
  };

  if (input.version_id !== undefined) {
    annotations[WORKLOAD_VERSION_ANNOTATION] = input.version_id;
  }

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
      replicas: options.replicas ?? input.config.replicas ?? DEFAULT_REPLICAS,
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
          ...(input.config.node_selector
            ? { nodeSelector: input.config.node_selector }
            : {}),
        },
      },
    },
  };
};

/**
 * The environment of the version being applied. It is written on deploy only,
 * so edits saved as a draft never reach running pods. A version's config never
 * changes, so its Secret is immutable.
 */
export const buildEnvSecret = (input: WorkloadManifestInput): V1Secret => ({
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: {
    ...workloadMetadata(input),
    name: envSecretNameOf(input),
  },
  type: 'Opaque',
  immutable: true,
  stringData: Object.fromEntries(
    (input.config.env ?? []).map(({ key, value }) => [key, value]),
  ),
});
