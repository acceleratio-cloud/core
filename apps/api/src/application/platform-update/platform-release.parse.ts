import type { StoredRelease } from './schemas/platform-update.schema';
import { compareVersions, normalizeVersion } from './platform-version.semver';

/** Release assets the console update needs. */
export const UPDATE_SCRIPT = 'update.sh';
export const INSTALL_SCRIPT = 'install.sh';
export const CHECKSUMS_FILE = 'SHA256SUMS';

const REQUIRED_ASSETS = [UPDATE_SCRIPT, INSTALL_SCRIPT, CHECKSUMS_FILE];

/** Longest release notes kept per release. */
const MAX_NOTES_LENGTH = 20_000;

interface GithubAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GithubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/**
 * Turns the GitHub "list releases" response into the stable releases the
 * console can install, newest first. Drafts, pre-releases, tags that are not
 * a version and releases without the installer scripts and SHA256SUMS are
 * left out.
 */
export const parseGithubReleases = (payload: unknown): StoredRelease[] => {
  if (!Array.isArray(payload)) {
    throw new Error('GitHub returned an unexpected releases response');
  }

  const releases: StoredRelease[] = [];
  const seen = new Set<string>();

  for (const item of payload as GithubRelease[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    if (item.draft === true || item.prerelease === true) {
      continue;
    }

    const tag = asString(item.tag_name);
    const version = normalizeVersion(tag);

    // Stable releases only: a pre-release suffix is skipped even when the
    // release is not flagged as a pre-release on GitHub.
    if (!tag || !version || version.includes('-') || seen.has(version)) {
      continue;
    }

    const assets = Array.isArray(item.assets)
      ? (item.assets as GithubAsset[])
      : [];
    const urls = new Map<string, string>();

    for (const asset of assets) {
      const name = asString(asset?.name);
      const url = asString(asset?.browser_download_url);

      if (name && url) {
        urls.set(name, url);
      }
    }

    if (!REQUIRED_ASSETS.every((name) => urls.has(name))) {
      continue;
    }

    seen.add(version);
    releases.push({
      version,
      tag,
      name: asString(item.name)?.trim() || `Acceleratio ${version}`,
      notes: (asString(item.body) ?? '').slice(0, MAX_NOTES_LENGTH),
      url: asString(item.html_url) ?? '',
      published_at: asString(item.published_at),
      checksums_url: urls.get(CHECKSUMS_FILE)!,
    });
  }

  return releases.sort((a, b) => compareVersions(b.version, a.version));
};

/** Releases newer than `current`, newest first. */
export const newerReleases = (
  releases: StoredRelease[],
  current: string | null,
): StoredRelease[] =>
  current === null
    ? []
    : releases.filter(
        (release) => compareVersions(release.version, current) > 0,
      );

/**
 * Parses a `sha256sum` listing (`<hash>  <file>` or `<hash> *<file>`) into a
 * map from file name to lowercase hash. Malformed lines are ignored.
 */
export const parseChecksums = (text: string): Map<string, string> => {
  const sums = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);

    if (match) {
      const file = match[2].replace(/^\.\//, '');
      sums.set(file, match[1].toLowerCase());
    }
  }

  return sums;
};

/** Base URL that a release's assets are downloaded from. */
export const releaseDownloadBase = (repository: string, tag: string): string =>
  `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;
