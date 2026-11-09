import type { NodeTypes } from '@xyflow/react';

import { DockerWorkloadCard } from './workload-cards/docker-workload-card';
import { GithubWorkloadCard } from './workload-cards/github-workload-card';
import { PostgresWorkloadCard } from './workload-cards/postgres-workload-card';
import { S3BucketWorkloadCard } from './workload-cards/s3-bucket-workload-card';

export const workloadNodeTypes = {
  docker: DockerWorkloadCard,
  s3_bucket: S3BucketWorkloadCard,
  github: GithubWorkloadCard,
  postgres: PostgresWorkloadCard,
} satisfies NodeTypes;
