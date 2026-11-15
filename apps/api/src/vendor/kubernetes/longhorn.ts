import type { KubernetesService } from './kubernetes.service';

/** The parts of a `nodes.longhorn.io` object the API reads. */
export interface LonghornNode {
  spec?: { allowScheduling?: boolean };
  status?: {
    conditions?: { type?: string; status?: string }[];
    /** Per disk, in bytes. */
    diskStatus?: Record<
      string,
      { storageMaximum?: number; storageAvailable?: number } | undefined
    >;
  };
}

export const longhornNamespace = (): string =>
  process.env.LONGHORN_NAMESPACE?.trim() || 'longhorn-system';

/**
 * Longhorn objects of a kind (`nodes`, `replicas`, `volumes`), or null when
 * they cannot be read: Longhorn is not installed (development uses
 * local-path) or the cluster is unreachable.
 */
export const listLonghorn = async <T>(
  kubernetes: KubernetesService,
  plural: string,
): Promise<T[] | null> => {
  try {
    const list = (await kubernetes.customObjects.listNamespacedCustomObject({
      group: 'longhorn.io',
      version: 'v1beta2',
      namespace: longhornNamespace(),
      plural,
    })) as { items?: T[] };

    return list.items ?? [];
  } catch {
    return null;
  }
};
