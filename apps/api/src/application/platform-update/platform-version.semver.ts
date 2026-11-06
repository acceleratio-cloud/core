/** A semantic version: `1.2.3` or `1.2.3-rc.1`, without a leading v. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses `1.2.3`, `v1.2.3` or `1.2.3-rc.1`; null for anything else. */
export const parseSemVer = (
  value: string | null | undefined,
): SemVer | null => {
  if (!value) {
    return null;
  }

  const match = SEMVER.exec(value.trim().replace(/^v/, ''));

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
};

/** The canonical form without a leading v, or null when it is not a version. */
export const normalizeVersion = (
  value: string | null | undefined,
): string | null => {
  const parsed = parseSemVer(value);

  if (!parsed) {
    return null;
  }

  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease.length > 0
    ? `${core}-${parsed.prerelease.join('.')}`
    : core;
};

const compareIdentifiers = (a: string, b: string): number => {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);

  if (aNumeric && bNumeric) {
    return Number(a) - Number(b);
  }

  if (aNumeric !== bNumeric) {
    // Numeric identifiers sort before alphanumeric ones.
    return aNumeric ? -1 : 1;
  }

  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Orders two versions by semantic version precedence: negative when `a` is
 * older, positive when newer, 0 when equal. Unparsable values sort first.
 */
export const compareVersions = (a: string, b: string): number => {
  const left = parseSemVer(a);
  const right = parseSemVer(b);

  if (!left || !right) {
    return left ? 1 : right ? -1 : 0;
  }

  const core =
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch;

  if (core !== 0) {
    return Math.sign(core);
  }

  // A pre-release is older than the release it precedes.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return (
      Number(right.prerelease.length > 0) - Number(left.prerelease.length > 0)
    );
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);

  for (let index = 0; index < length; index += 1) {
    const a1 = left.prerelease[index];
    const b1 = right.prerelease[index];

    if (a1 === undefined) {
      return -1;
    }

    if (b1 === undefined) {
      return 1;
    }

    const result = compareIdentifiers(a1, b1);

    if (result !== 0) {
      return Math.sign(result);
    }
  }

  return 0;
};

/** The tag of an image reference (`repo:tag`), ignoring a digest. */
export const imageTag = (image: string | null | undefined): string | null => {
  if (!image) {
    return null;
  }

  const withoutDigest = image.split('@')[0] ?? '';
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');

  return lastColon > lastSlash ? withoutDigest.slice(lastColon + 1) : null;
};
