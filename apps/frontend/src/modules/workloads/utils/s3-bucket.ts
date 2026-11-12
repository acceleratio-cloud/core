import type { WorkloadStatus } from '@acceleratio/shared';

export const BUCKET_NAME_MIN_LENGTH = 3;
export const BUCKET_NAME_MAX_LENGTH = 63;

const BUCKET_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const IP_ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Mirrors the API's bucket name check so mistakes show while typing. The
 * API stays the authority; this only explains the rule in the user's terms.
 */
export const bucketNameProblem = (value: string): string | null => {
  const name = value.trim();

  if (!name) {
    return 'Give the bucket a name.';
  }

  if (name.length < BUCKET_NAME_MIN_LENGTH) {
    return `Use at least ${BUCKET_NAME_MIN_LENGTH} characters.`;
  }

  if (name.length > BUCKET_NAME_MAX_LENGTH) {
    return `Keep it under ${BUCKET_NAME_MAX_LENGTH + 1} characters.`;
  }

  if (/[A-Z]/.test(name)) {
    return 'Use lowercase letters only.';
  }

  if (!BUCKET_NAME.test(name)) {
    return 'Use letters, digits and hyphens, starting and ending with a letter or digit.';
  }

  if (IP_ADDRESS.test(name)) {
    return 'A bucket name cannot look like an IP address.';
  }

  return null;
};

/**
 * A bucket's status in its own words: a provisioned bucket is "Ready", not
 * "Running", and its rollout is creation. Undefined keeps the shared word.
 */
export const bucketStatusLabel = (
  status: WorkloadStatus,
): string | undefined => {
  switch (status) {
    case 'running':
      return 'Ready';
    case 'deploying':
      return 'Creating';
    default:
      return undefined;
  }
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Decimal units, as file managers and S3 consoles show sizes. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1000) {
    return `${bytes} B`;
  }

  const exponent = Math.min(
    Math.floor(Math.log10(bytes) / 3),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1000 ** exponent;

  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
};

/** The folders of a prefix, for breadcrumbs: `a/b/` → `a/`, `a/b/`. */
export const prefixTrail = (
  prefix: string,
): { name: string; prefix: string }[] => {
  const segments = prefix.split('/').filter(Boolean);

  return segments.map((name, index) => ({
    name,
    prefix: `${segments.slice(0, index + 1).join('/')}/`,
  }));
};

/** Mirrors the API's rule for one file or folder name. */
export const objectNameProblem = (value: string): string | null => {
  const name = value.trim();

  if (!name) {
    return 'Enter a name.';
  }

  if (name.includes('/')) {
    return 'A name cannot contain /.';
  }

  if (name === '.' || name === '..') {
    return 'Choose another name.';
  }

  if (name.length > 255) {
    return 'Keep the name under 256 characters.';
  }

  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return 'A name cannot contain control characters.';
  }

  return null;
};
