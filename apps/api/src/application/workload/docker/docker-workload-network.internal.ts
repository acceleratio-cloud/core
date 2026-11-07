import { BadRequestException } from '@nestjs/common';
import {
  INTERNAL_HOSTNAME_MAX_LENGTH,
  internalHostname,
  isInternalHostname,
} from '@/common/naming';

/** Unique `(project_id, internal_hostname)` on the workload table. */
export const INTERNAL_HOSTNAME_CONSTRAINT =
  'workload_project_id_internal_hostname_unique';

export const INVALID_INTERNAL_HOSTNAME_MESSAGE = `A private hostname must be 1-${INTERNAL_HOSTNAME_MAX_LENGTH} lowercase letters, digits or hyphens, start with a letter and not end with a hyphen`;
export const INTERNAL_HOSTNAME_TAKEN_MESSAGE =
  'This private hostname is already used by another service in this project';

/** How many `-<n>` suffixes are tried before giving up on a free label. */
const PICK_ATTEMPTS_MAX = 1000;

/** Accepts `postgres` or `postgres.internal`, in any letter case. */
export const normalizeInternalHostname = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new BadRequestException(INVALID_INTERNAL_HOSTNAME_MESSAGE);
  }

  const hostname = value
    .trim()
    .toLowerCase()
    .replace(/\.internal\.?$/, '');

  if (!isInternalHostname(hostname)) {
    throw new BadRequestException(INVALID_INTERNAL_HOSTNAME_MESSAGE);
  }

  return hostname;
};

/**
 * First free label for a service name: `postgres`, then `postgres-2`, ...
 * `taken` holds every Service name already used in the project.
 */
export const pickInternalHostname = (
  name: string,
  taken: ReadonlySet<string>,
): string => {
  for (let attempt = 1; attempt <= PICK_ATTEMPTS_MAX; attempt += 1) {
    const candidate = internalHostname(name, attempt);

    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  throw new BadRequestException(INTERNAL_HOSTNAME_TAKEN_MESSAGE);
};
