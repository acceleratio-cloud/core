import { BadRequestException } from '@nestjs/common';
import type { WorkloadType } from '@acceleratio/shared';
import type { DockerWorkloadService } from '../docker/docker-workload.service';
import { WorkloadTypeRegistry } from '../workload-type.registry';

// The real Docker service pulls the ESM-only Kubernetes client. The registry
// only needs its `type` and identity.
jest.mock('../docker/docker-workload.service', () => ({
  DockerWorkloadService: class DockerWorkloadService {},
}));

const docker = { type: 'docker' } as unknown as DockerWorkloadService;

describe('WorkloadTypeRegistry', () => {
  it('returns the service registered for the docker type', () => {
    const registry = new WorkloadTypeRegistry(docker);

    expect(registry.get('docker')).toBe(docker);
  });

  it.each(['other', undefined, null])('rejects the unknown type %s', (type) => {
    const registry = new WorkloadTypeRegistry(docker);

    expect(() => registry.get(type as WorkloadType)).toThrow(
      BadRequestException,
    );
    expect(() => registry.get(type as WorkloadType)).toThrow(
      'Unsupported workload type',
    );
  });

  it('lists every registered service in registration order', () => {
    const registry = new WorkloadTypeRegistry(docker);

    expect(registry.all()).toEqual([docker]);
  });

  it('returns a copy so callers cannot mutate the registry', () => {
    const registry = new WorkloadTypeRegistry(docker);
    const services = registry.all();

    services.pop();

    expect(registry.all()).toHaveLength(1);
  });
});
