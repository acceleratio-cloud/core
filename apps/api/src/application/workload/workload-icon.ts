import { BadRequestException } from '@nestjs/common';
import {
  WORKLOAD_ICON_IDS,
  WORKLOAD_ICON_URL_MAX_LENGTH,
} from '@acceleratio/shared';

const PACK_IDS = new Set<string>(WORKLOAD_ICON_IDS);

/**
 * A workload icon is a built-in pack id, an `https://` URL, or null for the
 * type's default. Anything else is rejected before it reaches the database.
 */
export const normalizeWorkloadIcon = (icon: unknown): string | null => {
  if (icon === null) {
    return null;
  }

  if (typeof icon !== 'string') {
    throw new BadRequestException('icon must be a string or null');
  }

  const value = icon.trim();

  if (PACK_IDS.has(value)) {
    return value;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(
      'icon must be a built-in icon id or an https:// URL',
    );
  }

  if (url.protocol !== 'https:' || !url.hostname) {
    throw new BadRequestException('icon URL must use https://');
  }

  // Checked after normalization: percent-encoding can make `href` longer
  // than the input, and `href` is what the column stores.
  if (url.href.length > WORKLOAD_ICON_URL_MAX_LENGTH) {
    throw new BadRequestException(
      `icon URL must be at most ${WORKLOAD_ICON_URL_MAX_LENGTH} characters`,
    );
  }

  return url.href;
};
