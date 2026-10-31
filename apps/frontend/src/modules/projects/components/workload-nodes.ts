import type { NodeTypes } from '@xyflow/react';

import { DockerWorkloadCard } from './workload-cards/docker-workload-card';

export const workloadNodeTypes = {
  docker: DockerWorkloadCard,
} satisfies NodeTypes;
