import { Injectable } from '@nestjs/common';
import type { WorkloadType } from '@acceleratio/shared';
import { DockerWorkloadStatusDeriver } from './docker/docker-workload.deriver';
import type { WorkloadStatusDeriver } from './workload-status-deriver';

/**
 * Maps each workload type to its status deriver. The status service looks
 * derivers up by type and skip unknown types instead of failing a whole sweep.
 */
@Injectable()
export class WorkloadStatusDeriverRegistry {
  private readonly derivers = new Map<WorkloadType, WorkloadStatusDeriver>();

  constructor(dockerWorkloadStatusDeriver: DockerWorkloadStatusDeriver) {
    for (const deriver of [dockerWorkloadStatusDeriver]) {
      this.derivers.set(deriver.type, deriver);
    }
  }

  get(
    type: WorkloadType | null | undefined,
  ): WorkloadStatusDeriver | undefined {
    const deriver =
      type === null || type === undefined ? undefined : this.derivers.get(type);

    return deriver;
  }
}
