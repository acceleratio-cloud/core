import type { V1Pod } from '@kubernetes/client-node';
import { getKubernetesStatusCode } from './kubernetes-error';
import type { KubernetesService } from './kubernetes.service';

/** A pod that has not finished: pending, running or in an unknown phase. */
export const isActivePod = (pod: V1Pod): boolean =>
  pod.status?.phase !== 'Succeeded' && pod.status?.phase !== 'Failed';

/**
 * The pods of a namespace. A namespace that does not exist yet (a project
 * that never deployed) has none; any other failure is rethrown.
 */
export const listNamespacePods = async (
  kubernetes: KubernetesService,
  namespace: string,
): Promise<V1Pod[]> => {
  try {
    const { items } = await kubernetes.coreV1.listNamespacedPod({ namespace });

    return items;
  } catch (error) {
    if (getKubernetesStatusCode(error) === 404) {
      return [];
    }

    throw error;
  }
};
