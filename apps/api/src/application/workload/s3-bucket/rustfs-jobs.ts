import type { V1Job } from '@kubernetes/client-node';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  rustfsAdminSecret,
  rustfsNamespace,
  rustfsS3Endpoint,
} from '@/vendor/s3/rustfs';
import {
  type BucketJobInput,
  bucketJobName,
  buildBucketJob,
  DEFAULT_RUSTFS_RC_IMAGE,
  RC_CONTAINER,
  type RustfsTarget,
} from './s3-bucket.manifests';

export { rustfsS3Endpoint };

/** Where `rc` Jobs run and what they connect to. */
export const rustfsTarget = (): RustfsTarget => ({
  namespace: rustfsNamespace(),
  endpoint: rustfsS3Endpoint(),
  image: process.env.RUSTFS_RC_IMAGE?.trim() || DEFAULT_RUSTFS_RC_IMAGE,
  adminSecret: rustfsAdminSecret(),
});

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

/** The log of a Job's pod, where a failed `rc` step left its error. */
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
      container: RC_CONTAINER,
    });
  } catch {
    return null;
  }
};
