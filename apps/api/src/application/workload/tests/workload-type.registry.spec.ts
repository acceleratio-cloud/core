import { BadRequestException } from '@nestjs/common';
import type { WorkloadType } from '@acceleratio/shared';
import type { DockerWorkloadService } from '../docker/docker-workload.service';
import type { S3BucketWorkloadService } from '../s3-bucket/s3-bucket.service';
import type { GithubWorkloadService } from '../github/github-workload.service';
import { WorkloadTypeRegistry } from '../workload-type.registry';

// The real Docker service pulls the ESM-only Kubernetes client. The registry
// only needs its `type` and identity.
jest.mock('../docker/docker-workload.service', () => ({
  DockerWorkloadService: class DockerWorkloadService {},
}));
jest.mock('../github/github-workload.service', () => ({
  GithubWorkloadService: class GithubWorkloadService {},
}));
jest.mock('../s3-bucket/s3-bucket.service', () => ({
  S3BucketWorkloadService: class S3BucketWorkloadService {},
}));

const docker = { type: 'docker' } as unknown as DockerWorkloadService;
const bucket = { type: 's3_bucket' } as unknown as S3BucketWorkloadService;
const github = { type: 'github' } as unknown as GithubWorkloadService;

describe('WorkloadTypeRegistry', () => {
  it('returns the service registered for the docker type', () => {
    const registry = new WorkloadTypeRegistry(docker, bucket, github);

    expect(registry.get('docker')).toBe(docker);
  });

  it('returns the service registered for the s3_bucket type', () => {
    const registry = new WorkloadTypeRegistry(docker, bucket, github);

    expect(registry.get('s3_bucket')).toBe(bucket);
  });

  it.each(['other', undefined, null])('rejects the unknown type %s', (type) => {
    const registry = new WorkloadTypeRegistry(docker, bucket, github);

    expect(() => registry.get(type as WorkloadType)).toThrow(
      BadRequestException,
    );
    expect(() => registry.get(type as WorkloadType)).toThrow(
      'Unsupported workload type',
    );
  });

  it('lists every registered service in registration order', () => {
    const registry = new WorkloadTypeRegistry(docker, bucket, github);

    expect(registry.all()).toEqual([docker, bucket, github]);
  });

  it('returns a copy so callers cannot mutate the registry', () => {
    const registry = new WorkloadTypeRegistry(docker, bucket, github);
    const services = registry.all();

    services.pop();

    expect(registry.all()).toHaveLength(3);
  });
});
