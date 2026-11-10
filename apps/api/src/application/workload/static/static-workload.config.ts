import { BadRequestException } from '@nestjs/common';
import type {
  DockerWorkloadConfig,
  StaticWorkloadConfig,
  WorkloadConfig,
} from '@acceleratio/shared';
import { normalizeDockerConfig } from '../docker/docker-workload.config';
import { STATIC_SERVER_IMAGE } from './static-workload.manifests';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A release id from a request; it becomes a filer folder name. */
export const releaseIdOf = (value: unknown): string => {
  if (typeof value !== 'string' || !UUID.test(value.toLowerCase())) {
    throw new BadRequestException('release_id must be a UUID');
  }

  return value.toLowerCase();
};

/**
 * Config of a static site, in the Docker shape the Docker service deploys:
 * only resources and the release are the user's. The server image is left
 * out and set on apply, so versions never pin one and an image upgrade shows
 * no change the user did not make.
 */
export const normalizeStaticConfig = (
  config: WorkloadConfig | undefined,
): DockerWorkloadConfig => {
  const candidate = (config ?? {}) as StaticWorkloadConfig;
  // The image only satisfies the Docker validation; it is not stored.
  const normalized: Partial<DockerWorkloadConfig> = normalizeDockerConfig({
    docker_image: STATIC_SERVER_IMAGE,
    cpu_max: candidate.cpu_max,
    ram_max: candidate.ram_max,
    replicas: candidate.replicas,
  });

  delete normalized.docker_image;

  return (
    candidate.release_id === undefined
      ? normalized
      : { ...normalized, release_id: releaseIdOf(candidate.release_id) }
  ) as DockerWorkloadConfig;
};

export const releaseOf = (config: unknown): string | null =>
  (config as StaticWorkloadConfig | null)?.release_id ?? null;
