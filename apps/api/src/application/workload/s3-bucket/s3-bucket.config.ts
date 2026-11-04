import { BadRequestException } from '@nestjs/common';

export const BUCKET_NAME_MIN_LENGTH = 3;
export const BUCKET_NAME_MAX_LENGTH = 63;

const BUCKET_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const IP_ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONFIG_KEYS = new Set(['storage_class_id']);

const BUCKET_NAME_RULES =
  'Bucket names use 3–63 lowercase letters, digits and hyphens, and start and end with a letter or digit';

/**
 * S3 bucket naming, restricted to what every S3 client accepts. Periods are
 * left out on purpose: they break virtual-hosted URLs over TLS, and the
 * hyphen-only form is also a valid Kubernetes label, so the bucket name can
 * name the Secret that holds its keys.
 */
export const normalizeBucketName = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('Bucket name is required');
  }

  const name = value.trim();

  if (
    name.length < BUCKET_NAME_MIN_LENGTH ||
    name.length > BUCKET_NAME_MAX_LENGTH ||
    !BUCKET_NAME.test(name) ||
    IP_ADDRESS.test(name)
  ) {
    throw new BadRequestException(BUCKET_NAME_RULES);
  }

  return name;
};

/**
 * The create config: an optional storage profile. Null or absent means the
 * platform profile, which the service resolves.
 */
export const normalizeBucketConfig = (
  value: unknown,
): { storage_class_id: string | null } => {
  if (value === undefined || value === null) {
    return { storage_class_id: null };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('config must be an object');
  }

  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new BadRequestException(`Unknown bucket setting: ${key}`);
    }
  }

  const id = record.storage_class_id;

  if (id === undefined || id === null || id === '') {
    return { storage_class_id: null };
  }

  if (typeof id !== 'string' || !UUID.test(id)) {
    throw new BadRequestException(
      'storage_class_id must be a storage profile id',
    );
  }

  return { storage_class_id: id.toLowerCase() };
};

/** S3 allows 1024 bytes per key; one segment is a file name on the filer. */
export const OBJECT_KEY_MAX_BYTES = 1024;
export const SEGMENT_MAX_LENGTH = 255;

// Control characters break the filer's paths and most S3 tools.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const splitSegments = (value: string, label: string): string[] => {
  const segments = value.split('/');

  for (const segment of segments) {
    if (!segment) {
      throw new BadRequestException(`${label} cannot contain empty segments`);
    }

    if (segment === '.' || segment === '..') {
      throw new BadRequestException(`${label} cannot contain . or ..`);
    }

    if (segment.length > SEGMENT_MAX_LENGTH) {
      throw new BadRequestException(
        `Each name in ${label.toLowerCase()} is limited to ${SEGMENT_MAX_LENGTH} characters`,
      );
    }

    if (CONTROL_CHARACTERS.test(segment)) {
      throw new BadRequestException(
        `${label} cannot contain control characters`,
      );
    }
  }

  return segments;
};

/**
 * A folder to list: `""` for the bucket root, otherwise segments joined by
 * `/` with one trailing `/`. Leading slashes are tolerated.
 */
export const normalizePrefix = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('prefix must be a string');
  }

  const trimmed = value.replace(/^\/+/, '').replace(/\/+$/, '');

  if (!trimmed) {
    return '';
  }

  return `${splitSegments(trimmed, 'Folder path').join('/')}/`;
};

/**
 * A file or folder key from the bucket root. A folder key ends with `/`;
 * `kind` says which one the caller means, so `a/b` and `a/b/` are not mixed
 * up.
 */
export const normalizeObjectPath = (
  value: unknown,
  kind: 'file' | 'folder',
): string => {
  const label = kind === 'file' ? 'File path' : 'Folder path';

  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${label} is required`);
  }

  const relative = value.replace(/^\/+/, '');

  if (kind === 'file' && relative.endsWith('/')) {
    throw new BadRequestException('File path cannot end with /');
  }

  const trimmed = kind === 'folder' ? relative.replace(/\/+$/, '') : relative;
  const key = splitSegments(trimmed, label).join('/');
  const result = kind === 'folder' ? `${key}/` : key;

  if (Buffer.byteLength(result, 'utf8') > OBJECT_KEY_MAX_BYTES) {
    throw new BadRequestException(
      `${label} is limited to ${OBJECT_KEY_MAX_BYTES} bytes`,
    );
  }

  return result;
};
