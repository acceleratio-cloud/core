import { BadRequestException } from '@nestjs/common';
import {
  normalizeBucketConfig,
  normalizeBucketName,
  normalizeObjectPath,
  normalizePrefix,
} from '../s3-bucket.config';

const profileId = '7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f';

describe('normalizeBucketName', () => {
  it.each(['abc', 'demo-assets', 'a1-b2-c3', 'x'.repeat(63), '  logs  '])(
    'accepts %p',
    (name) => {
      expect(normalizeBucketName(name)).toBe(name.trim());
    },
  );

  it.each([
    ['ab', 'too short'],
    ['x'.repeat(64), 'too long'],
    ['Demo', 'upper case'],
    ['demo_assets', 'underscore'],
    ['demo.assets', 'period'],
    ['-demo', 'leading hyphen'],
    ['demo-', 'trailing hyphen'],
    ['dé-mo', 'non-ASCII'],
  ])('rejects %p (%s)', (name) => {
    expect(() => normalizeBucketName(name)).toThrow(BadRequestException);
    expect(() => normalizeBucketName(name)).toThrow(
      /3–63 lowercase letters, digits and hyphens/,
    );
  });

  it.each([undefined, null, '', '   ', 42])('requires a name (%p)', (name) => {
    expect(() => normalizeBucketName(name)).toThrow('Bucket name is required');
  });
});

describe('normalizeBucketConfig', () => {
  it.each([
    undefined,
    null,
    {},
    { storage_class_id: null },
    { storage_class_id: '' },
  ])('falls back to the platform profile for %p', (config) => {
    expect(normalizeBucketConfig(config)).toEqual({ storage_class_id: null });
  });

  it('keeps a chosen profile, lowercased', () => {
    expect(
      normalizeBucketConfig({ storage_class_id: profileId.toUpperCase() }),
    ).toEqual({ storage_class_id: profileId });
  });

  it('rejects unknown keys', () => {
    expect(() =>
      normalizeBucketConfig({ storage_class_id: profileId, versioning: true }),
    ).toThrow('Unknown bucket setting: versioning');
  });

  it.each(['not-a-uuid', 12, ['a']])('rejects the profile id %p', (id) => {
    expect(() => normalizeBucketConfig({ storage_class_id: id })).toThrow(
      'storage_class_id must be a storage profile id',
    );
  });

  it('rejects a config that is not an object', () => {
    expect(() => normalizeBucketConfig(['x'])).toThrow(
      'config must be an object',
    );
  });
});

describe('normalizePrefix', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['/', ''],
    ['docs', 'docs/'],
    ['/docs/2026/', 'docs/2026/'],
    ['my résumé', 'my résumé/'],
  ])('maps %p to %p', (input, expected) => {
    expect(normalizePrefix(input)).toBe(expected);
  });

  it.each(['a//b', '../etc', 'a/./b', 'tab\there'])('rejects %p', (input) => {
    expect(() => normalizePrefix(input)).toThrow(BadRequestException);
  });
});

describe('normalizeObjectPath', () => {
  it('keeps a file key and strips a leading slash', () => {
    expect(normalizeObjectPath('/docs/a.txt', 'file')).toBe('docs/a.txt');
  });

  it('gives a folder key one trailing slash', () => {
    expect(normalizeObjectPath('docs/new', 'folder')).toBe('docs/new/');
    expect(normalizeObjectPath('docs/new//', 'folder')).toBe('docs/new/');
  });

  it('refuses a file key that names a folder', () => {
    expect(() => normalizeObjectPath('docs/', 'file')).toThrow(
      'File path cannot end with /',
    );
  });

  it.each([undefined, '', '   ', 5])('requires a path (%p)', (input) => {
    expect(() => normalizeObjectPath(input, 'file')).toThrow(
      'File path is required',
    );
  });

  it('limits a key to 1024 bytes and a name to 255 characters', () => {
    const long = Array.from({ length: 6 }, () => 'x'.repeat(200)).join('/');

    expect(() => normalizeObjectPath(long, 'file')).toThrow('1024 bytes');
    expect(() => normalizeObjectPath('x'.repeat(256), 'folder')).toThrow(
      '255 characters',
    );
  });
});
