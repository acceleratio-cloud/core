import { Injectable } from '@nestjs/common';
import type { DerivedWorkloadStatus } from './docker-workload.status';
import { deriveStatus } from './docker-workload.status';
import type {
  WorkloadStatusDeriver,
  WorkloadStatusSnapshot,
} from '../workload-status-deriver';

/** Docker workloads are plain Deployments, so the deriver is `deriveStatus`. */
@Injectable()
export class DockerWorkloadStatusDeriver implements WorkloadStatusDeriver {
  readonly type = 'docker' as const;

  derive(snapshot: WorkloadStatusSnapshot): DerivedWorkloadStatus {
    return deriveStatus(snapshot.deployment, snapshot.pods);
  }
}
