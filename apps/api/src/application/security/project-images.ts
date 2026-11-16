import type { V1Pod } from '@kubernetes/client-node';
import type { WorkloadType } from '@acceleratio/shared';
import { WORKLOAD_ID_LABEL } from '../workload/docker/docker-workload.manifests';
import { scanTarget } from './image-scan.manifests';

export interface ProjectWorkloadRef {
  id: string;
  name: string;
  type: WorkloadType;
}

/** One image a service runs, as the cluster pulled it. */
export interface ProjectImage {
  workload_id: string;
  workload_name: string;
  container: string;
  image: string;
  digest: string;
  /** `<repository>@<digest>`, from the pod status. */
  image_id: string;
  managed: boolean;
}

/** The platform picks these images; a platform update replaces them. */
const MANAGED_TYPES = new Set<WorkloadType>(['postgres', 'static']);

/**
 * The images the project's services run now: each running container of a pod
 * that belongs to a service, once per service, container and digest. Init
 * containers, pods of no service and pods that ended or are leaving are left out.
 */
export const projectImages = (
  pods: V1Pod[],
  workloads: ProjectWorkloadRef[],
): ProjectImage[] => {
  const byId = new Map(workloads.map((item) => [item.id, item]));
  const images = new Map<string, ProjectImage>();

  for (const pod of pods) {
    const owner = byId.get(pod.metadata?.labels?.[WORKLOAD_ID_LABEL] ?? '');

    // Evicted and finished pods linger with their old images; leaving ones are on their way out.
    if (
      !owner ||
      pod.metadata?.deletionTimestamp ||
      pod.status?.phase === 'Failed' ||
      pod.status?.phase === 'Succeeded'
    ) {
      continue;
    }

    for (const status of pod.status?.containerStatuses ?? []) {
      const imageId = status.imageID ?? '';

      if (!scanTarget(imageId)) {
        continue;
      }

      const digest = imageId.slice(imageId.lastIndexOf('@') + 1);
      const key = `${owner.id}\0${status.name}\0${digest}`;

      if (images.has(key)) {
        continue;
      }

      // The status may name the image by its id; the spec has what was asked for.
      const spec = pod.spec?.containers.find(
        (container) => container.name === status.name,
      );

      images.set(key, {
        workload_id: owner.id,
        workload_name: owner.name,
        container: status.name,
        image: spec?.image ?? status.image,
        digest,
        image_id: imageId.replace(/^docker-pullable:\/\//, ''),
        managed: MANAGED_TYPES.has(owner.type),
      });
    }
  }

  return [...images.values()].sort(
    (a, b) =>
      a.workload_name.localeCompare(b.workload_name) ||
      a.container.localeCompare(b.container),
  );
};
