import {
  compareVersions,
  imageTag,
  normalizeVersion,
} from '../platform-version.semver';

describe('platform version semver', () => {
  it('normalizes release tags and rejects anything else', () => {
    expect(normalizeVersion('v0.1.6')).toBe('0.1.6');
    expect(normalizeVersion('1.2.3-rc.1')).toBe('1.2.3-rc.1');
    expect(normalizeVersion(' 2.0.0+build.5 ')).toBe('2.0.0');
    expect(normalizeVersion('latest')).toBeNull();
    expect(normalizeVersion('1.2')).toBeNull();
    expect(normalizeVersion('01.2.3')).toBeNull();
    expect(normalizeVersion(undefined)).toBeNull();
  });

  it('orders versions by semantic version precedence', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1);
    expect(compareVersions('1.0.0-rc', '1.0.0-rc.1')).toBe(-1);
  });

  it('sorts unparsable versions first', () => {
    expect(compareVersions('dev', '0.0.1')).toBe(-1);
    expect(compareVersions('0.0.1', 'dev')).toBe(1);
    expect(compareVersions('dev', 'main')).toBe(0);
  });

  it('reads the tag of an image reference', () => {
    expect(imageTag('ghcr.io/acceleratio-cloud/api:0.1.6')).toBe('0.1.6');
    expect(imageTag('localhost:5000/api:dev')).toBe('dev');
    expect(imageTag('localhost:5000/api')).toBeNull();
    expect(imageTag('postgres:17-alpine@sha256:abc')).toBe('17-alpine');
    expect(imageTag(null)).toBeNull();
  });
});
