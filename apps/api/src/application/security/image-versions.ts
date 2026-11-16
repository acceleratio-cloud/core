/** A tag read as a version: `v2.148.3`, `2.11.9-alpine`, `17.6.1.136`. */
export interface TagVersion {
  prefix: '' | 'v';
  numbers: number[];
  /** What follows the numbers, with a build hash collapsed: `alpine`, `ubi9`. */
  line: string;
  prerelease: boolean;
}

const TAG = /^(v?)(\d+(?:\.\d+)*)(?:[-_](.+))?$/;
const PRERELEASE =
  /(^|[.-])(alpha|beta|rc|pre|preview|dev|snapshot|nightly|canary|test)\d*([.-]|$)/i;
/** `sha-a05e7ec`, `a05e7ec1`: a build of the version, not a line of its own. */
const BUILD_HASH = /^(sha-)?[0-9a-f]{7,40}$/i;

export const parseTag = (tag: string): TagVersion | null => {
  const match = TAG.exec(tag);

  if (!match) {
    return null;
  }

  const [, prefix, numbers, suffix = ''] = match;

  return {
    prefix: prefix as TagVersion['prefix'],
    numbers: numbers.split('.').map(Number),
    line: BUILD_HASH.test(suffix) ? '#build' : suffix.toLowerCase(),
    prerelease: PRERELEASE.test(suffix),
  };
};

const compare = (a: number[], b: number[]): number => {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};

/**
 * The newest release of the same line as `current`: same `v` prefix, as many
 * version numbers, the same major and the same suffix (`-alpine` stays
 * `-alpine`). Pre-releases only follow a pre-release. Null when `current` is
 * not a version or nothing newer exists.
 */
export const newerTag = (current: string, tags: string[]): string | null => {
  const base = parseTag(current);

  if (!base) {
    return null;
  }

  let best: { tag: string; version: TagVersion } | null = null;

  for (const tag of tags) {
    const version = parseTag(tag);

    if (
      !version ||
      version.prefix !== base.prefix ||
      version.numbers.length !== base.numbers.length ||
      version.numbers[0] !== base.numbers[0] ||
      version.line !== base.line ||
      (version.prerelease && !base.prerelease) ||
      compare(version.numbers, base.numbers) <= 0
    ) {
      continue;
    }

    if (!best || compare(version.numbers, best.version.numbers) > 0) {
      best = { tag, version };
    }
  }

  return best?.tag ?? null;
};
