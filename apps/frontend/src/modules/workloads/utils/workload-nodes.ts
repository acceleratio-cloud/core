import type { DockerWorkloadNode } from '../components/workload-cards/docker-workload-card';

import type { Workload } from '@acceleratio/shared';

export type WorkloadNode = DockerWorkloadNode;

/**
 * Canvas nodes are a direct projection of the stored coordinates. Placement
 * and collision handling belong to the API, so every session renders the same
 * position for the same workload.
 */
export const toWorkloadNodes = (workloads: Workload[]): WorkloadNode[] =>
  workloads.map((workload) => ({
    id: workload.id,
    type: workload.type,
    position: { x: workload.position.x, y: workload.position.y },
    data: workload as WorkloadNode['data'],
  }));
