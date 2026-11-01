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
