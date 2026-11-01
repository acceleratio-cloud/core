import type { DockerWorkloadNode } from '../components/workload-cards/docker-workload-card';

import type { Workload } from '@acceleratio/shared';

export type WorkloadNode = DockerWorkloadNode;

const DUPLICATE_OFFSET_X = 300;

/**
 * New workloads start at { x: 0, y: 0 }, so nodes sharing a position are
 * nudged horizontally until real canvas positioning exists.
 */
export const toWorkloadNodes = (workloads: Workload[]): WorkloadNode[] => {
  const seen = new Map<string, number>();

  return workloads.map((workload) => {
    const positionKey = `${workload.position.x}:${workload.position.y}`;
    const duplicateIndex = seen.get(positionKey) ?? 0;
    seen.set(positionKey, duplicateIndex + 1);

    return {
      id: workload.id,
      type: workload.type,
      position: {
        x: workload.position.x + duplicateIndex * DUPLICATE_OFFSET_X,
        y: workload.position.y,
      },
      data: workload as WorkloadNode['data'],
    };
  });
};
