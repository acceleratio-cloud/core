import type { V1Job } from '@kubernetes/client-node';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  type BucketJobInput,
  bucketJobName,
  buildBucketJob,
  DEFAULT_S3_ENDPOINT,
  DEFAULT_SEAWEEDFS_FILER,
  DEFAULT_SEAWEEDFS_MASTER,
  DEFAULT_SEAWEEDFS_NAMESPACE,
  DEFAULT_SEAWEEDFS_SHELL_IMAGE,
  type SeaweedfsTarget,
  SHELL_CONTAINER,
} from './s3-bucket.manifests';

/** Where `weed shell` Jobs run and what they connect to. */
export const seaweedfsTarget = (): SeaweedfsTarget => ({
  namespace:
    process.env.SEAWEEDFS_NAMESPACE?.trim() || DEFAULT_SEAWEEDFS_NAMESPACE,
  master: process.env.SEAWEEDFS_MASTER?.trim() || DEFAULT_SEAWEEDFS_MASTER,
  filer: process.env.SEAWEEDFS_FILER?.trim() || DEFAULT_SEAWEEDFS_FILER,
  image:
    process.env.SEAWEEDFS_SHELL_IMAGE?.trim() || DEFAULT_SEAWEEDFS_SHELL_IMAGE,
});

/** The S3 gateway, as pods in the cluster reach it. */
export const seaweedfsS3Endpoint = (): string =>
  process.env.SEAWEEDFS_S3_ENDPOINT?.trim() || DEFAULT_S3_ENDPOINT;

export const readBucketJob = async (
  kubernetes: KubernetesService,
  name: string,
  namespace: string,
): Promise<V1Job | null> => {
  try {
    return await kubernetes.batchV1.readNamespacedJob({ name, namespace });
  } catch (error) {
    if (getKubernetesStatusCode(error) === 404) {
      return null;
    }

    throw error;
  }
};

/** Replaces a finished Job of the same name, then starts the new one. */
export const startBucketJob = async (
  kubernetes: KubernetesService,
  input: BucketJobInput,
): Promise<V1Job> => {
  const name = bucketJobName(input.workloadId, input.operation);
  const namespace = input.target.namespace;

  try {
    await kubernetes.batchV1.deleteNamespacedJob({
      name,
      namespace,
      propagationPolicy: 'Foreground',
    });
  } catch (error) {
    if (getKubernetesStatusCode(error) !== 404) {
      throw error;
    }
  }

  // Foreground deletion keeps the object until its pods are gone.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await readBucketJob(kubernetes, name, namespace)) === null) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return kubernetes.batchV1.createNamespacedJob({
    namespace,
    body: buildBucketJob(input),
  });
};

/** The log of a Job's pod, where a failed `weed shell` step left its error. */
export const readBucketJobLog = async (
  kubernetes: KubernetesService,
  name: string,
  namespace: string,
): Promise<string | null> => {
  try {
    const pods = await kubernetes.coreV1.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${name}`,
    });
    const pod = pods.items[0]?.metadata?.name;

    if (!pod) {
      return null;
    }

    return await kubernetes.coreV1.readNamespacedPodLog({
      name: pod,
      namespace,
      container: SHELL_CONTAINER,
    });
  } catch {
    return null;
  }
};
