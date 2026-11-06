import {
  newerReleases,
  parseChecksums,
  parseGithubReleases,
  releaseDownloadBase,
} from '../platform-release.parse';

const assets = (
  tag: string,
  names = ['install.sh', 'update.sh', 'SHA256SUMS'],
) =>
  names.map((name) => ({
    name,
    browser_download_url: `https://github.com/acceleratio-cloud/core/releases/download/${tag}/${name}`,
  }));

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `Acceleratio ${tag.slice(1)}`,
  body: `Notes for ${tag}`,
  html_url: `https://github.com/acceleratio-cloud/core/releases/tag/${tag}`,
  published_at: '2026-11-06T14:15:18Z',
  draft: false,
  prerelease: false,
  assets: assets(tag),
  ...extra,
});

describe('parseGithubReleases', () => {
  it('keeps stable releases with the installer assets, newest first', () => {
    const releases = parseGithubReleases([
      release('v0.1.5'),
      release('v0.1.10'),
      release('v0.2.0-rc.1', { prerelease: true }),
      release('v0.3.0-rc.1'),
      release('v0.4.0', { draft: true }),
      release('nightly'),
      release('v0.1.7', { assets: assets('v0.1.7', ['install.sh']) }),
      release('v0.1.6'),
    ]);

    expect(releases.map((item) => item.version)).toEqual([
      '0.1.10',
      '0.1.6',
      '0.1.5',
    ]);
    expect(releases[0]).toEqual({
      version: '0.1.10',
      tag: 'v0.1.10',
      name: 'Acceleratio 0.1.10',
      notes: 'Notes for v0.1.10',
      url: 'https://github.com/acceleratio-cloud/core/releases/tag/v0.1.10',
      published_at: '2026-11-06T14:15:18Z',
      checksums_url:
        'https://github.com/acceleratio-cloud/core/releases/download/v0.1.10/SHA256SUMS',
    });
  });

  it('falls back to a generated name and empty notes', () => {
    const [parsed] = parseGithubReleases([
      release('v1.0.0', { name: '  ', body: null }),
    ]);

    expect(parsed.name).toBe('Acceleratio 1.0.0');
    expect(parsed.notes).toBe('');
  });

  it('rejects a response that is not a list', () => {
    expect(() => parseGithubReleases({ message: 'Not Found' })).toThrow(
      'unexpected releases response',
    );
  });
});

describe('newerReleases', () => {
  const releases = parseGithubReleases([
    release('v0.2.0'),
    release('v0.1.7'),
    release('v0.1.6'),
  ]);

  it('lists the releases above the running version', () => {
    expect(
      newerReleases(releases, '0.1.6').map((item) => item.version),
    ).toEqual(['0.2.0', '0.1.7']);
    expect(newerReleases(releases, '0.2.0')).toEqual([]);
  });

  it('offers nothing to a development build', () => {
    expect(newerReleases(releases, null)).toEqual([]);
  });
});

describe('parseChecksums', () => {
  it('reads sha256sum output in text and binary mode', () => {
    const update = 'a'.repeat(64);
    const install = 'B'.repeat(64);
    const sums = parseChecksums(
      `${update}  update.sh\n${install} *./install.sh\r\nnot a checksum line\n`,
    );

    expect(sums.get('update.sh')).toBe(update);
    expect(sums.get('install.sh')).toBe('b'.repeat(64));
    expect(sums.size).toBe(2);
  });
});

it('builds the release download URL', () => {
  expect(releaseDownloadBase('acceleratio-cloud/core', 'v0.1.6')).toBe(
    'https://github.com/acceleratio-cloud/core/releases/download/v0.1.6',
  );
});
