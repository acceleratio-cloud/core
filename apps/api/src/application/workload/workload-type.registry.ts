import { BadRequestException, Injectable } from '@nestjs/common';
import type { WorkloadType } from '@acceleratio/shared';
import { DockerWorkloadService } from './docker/docker-workload.service';
import { GithubWorkloadService } from './github/github-workload.service';
import { S3BucketWorkloadService } from './s3-bucket/s3-bucket.service';
import type { WorkloadTypeService } from './workload-type-service';

const UNSUPPORTED_TYPE_MESSAGE = 'Unsupported workload type';

/**
 * Maps each workload type to its full service. Adding a type means adding a
 * folder with its service and registering it here; the facade, resolver and
 * existing type services stay untouched.
 */
@Injectable()
export class WorkloadTypeRegistry {
  private readonly services = new Map<WorkloadType, WorkloadTypeService>();

  constructor(
    dockerWorkloadService: DockerWorkloadService,
    s3BucketWorkloadService: S3BucketWorkloadService,
    githubWorkloadService: GithubWorkloadService,
  ) {
    for (const service of [
      dockerWorkloadService,
      s3BucketWorkloadService,
      githubWorkloadService,
    ]) {
      this.services.set(service.type, service);
    }
  }

  get(type: WorkloadType | null | undefined): WorkloadTypeService {
    const service =
      type === null || type === undefined ? undefined : this.services.get(type);

    if (service === undefined) {
      throw new BadRequestException(UNSUPPORTED_TYPE_MESSAGE);
    }

    return service;
  }

  all(): WorkloadTypeService[] {
    return [...this.services.values()];
  }
}
