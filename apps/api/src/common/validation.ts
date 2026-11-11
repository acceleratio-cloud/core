import { BadRequestException } from '@nestjs/common';

export const NAME_MAX_LENGTH = 255;

/**
 * Input checks shared by submodules. Controllers never validate; services call
 * these helpers so one rule cannot drift between them.
 */
export const normalizeName = (name: unknown): string => {
  if (typeof name !== 'string' || !name.trim()) {
    throw new BadRequestException('Name is required');
  }

  const trimmed = name.trim();

  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new BadRequestException(
      `Keep the name under ${NAME_MAX_LENGTH} characters`,
    );
  }

  return trimmed;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);
