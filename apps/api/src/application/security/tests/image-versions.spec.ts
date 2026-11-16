import { newerTag, parseTag } from '../image-versions';

describe('parseTag', () => {
  it('reads versions with a prefix, a suffix or a build hash', () => {
    expect(parseTag('v2.148.3')).toEqual({
      prefix: 'v',
      numbers: [2, 148, 3],
      line: '',
      prerelease: false,
    });
    expect(parseTag('8.0.38-ubi9')?.line).toBe('ubi9');
    expect(parseTag('2026.11.02-sha-a05e7ec')?.line).toBe('#build');
    expect(parseTag('3.0.0-rc1')?.prerelease).toBe(true);
    expect(parseTag('latest')).toBeNull();
  });
});

describe('newerTag', () => {
  const tags = [
    'v2.148.3',
    'v2.149.0',
    'v2.150.1',
    'v3.0.0',
    'v2.151.0-rc1',
    '2.152.0',
    'latest',
  ];

  it('takes the newest release of the same major, prefix and suffix', () => {
    expect(newerTag('v2.148.3', tags)).toBe('v2.150.1');
    expect(
      newerTag('2.11.9-alpine', ['2.11.10', '2.11.10-alpine', '2.12.0-alpine']),
    ).toBe('2.12.0-alpine');
    expect(newerTag('17.6.1.136', ['17.6.1.140', '17.6.2', '18.0.0.1'])).toBe(
      '17.6.1.140',
    );
  });

  it('follows builds of a calendar version', () => {
    expect(
      newerTag('2026.11.02-sha-a05e7ec', [
        '2026.11.09-sha-b1c2d3e',
        '2026.10.01-sha-0000000',
      ]),
    ).toBe('2026.11.09-sha-b1c2d3e');
  });

  it('gives nothing when there is no newer release or no version', () => {
    expect(newerTag('v3.0.0', tags)).toBeNull();
    expect(newerTag('latest', tags)).toBeNull();
  });
});
