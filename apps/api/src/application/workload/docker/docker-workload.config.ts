import { BadRequestException } from '@nestjs/common';
import type { DockerWorkloadConfig, WorkloadConfig } from '@acceleratio/shared';

/**
 * Docker configs keep only the image. A legacy `port` from JSONB is dropped
 * here and in `toWorkload`, so it never reaches the API contract.
 */
export const normalizeDockerConfig = (
  config: WorkloadConfig | undefined,
): DockerWorkloadConfig => {
  const candidate = config as Partial<DockerWorkloadConfig> | null | undefined;
  const image = candidate?.docker_image;

  if (typeof image !== 'string' || !image.trim()) {
    throw new BadRequestException('docker_image is required');
  }

  return { docker_image: image.trim() };
};
