import { parseImageReference } from '../oci-registry.client';

describe('parseImageReference', () => {
  it('fills in Docker Hub and its library namespace', () => {
    expect(parseImageReference('nginx:1.27')).toEqual({
      host: 'registry-1.docker.io',
      registry: 'docker.io',
      repository: 'library/nginx',
      tag: '1.27',
    });
    expect(parseImageReference('supabase/realtime')).toMatchObject({
      repository: 'supabase/realtime',
      tag: 'latest',
    });
  });

  it('keeps other registries, ports and digests apart from tags', () => {
    expect(parseImageReference('ghcr.io/acme/api:v2')).toMatchObject({
      host: 'ghcr.io',
      repository: 'acme/api',
      tag: 'v2',
    });
    expect(parseImageReference('localhost:5000/app')).toMatchObject({
      registry: 'localhost:5000',
      repository: 'app',
      tag: 'latest',
    });
    expect(
      parseImageReference(`nginx@sha256:${'a'.repeat(64)}`)?.tag,
    ).toBeNull();
  });

  it('refuses what is not an image name', () => {
    expect(parseImageReference('Not An Image')).toBeNull();
    expect(parseImageReference('acme/../etc:1')).toBeNull();
  });
});
