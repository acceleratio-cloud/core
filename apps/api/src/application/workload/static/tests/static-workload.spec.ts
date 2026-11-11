import { BadRequestException } from '@nestjs/common';
import { buildDeployment } from '../../docker/docker-workload.manifests';
import {
  isServedPath,
  normalizeStaticConfig,
  releaseIdOf,
} from '../static-workload.config';
import {
  buildSiteClaim,
  buildSiteVolume,
  SITE_READINESS_PROBE,
  siteServerArgs,
  STATIC_SERVER_IMAGE,
} from '../static-workload.manifests';

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const releaseId = '9b2f6a0e-1c3d-4e5f-8a7b-6c5d4e3f2a1b';
const site = { id: workloadId, project_id: projectId, name: 'Docs' };

describe('static site config', () => {
  it('keeps only resources and the release, never an image', () => {
    expect(
      normalizeStaticConfig({
        docker_image: 'evil:latest',
        command: ['sh'],
        replicas: 2,
        release_id: releaseId.toUpperCase(),
      }),
    ).toEqual({ replicas: 2, release_id: releaseId });
  });

  it.each(['../etc', 'abc', 42])('rejects the release id %p', (value) => {
    expect(() => releaseIdOf(value)).toThrow(BadRequestException);
  });
});

describe('isServedPath', () => {
  it.each(['index.html', 'assets/app.js', '.well-known/security.txt'])(
    'keeps %s',
    (path) => expect(isServedPath(path)).toBe(true),
  );

  it.each([
    '.env',
    '.git/config',
    'assets/.DS_Store',
    'docs/.well-known/x',
    '.well-known/.secret',
  ])('drops %s', (path) => expect(isServedPath(path)).toBe(false));
});

describe('static site manifests', () => {
  it('mounts the filer folder of the site read-only through a pre-bound volume', () => {
    const volume = buildSiteVolume(site);
    const claim = buildSiteClaim(site);

    expect(volume.spec?.csi).toMatchObject({
      driver: 'seaweedfs-csi-driver',
      readOnly: true,
      volumeAttributes: { path: `/sites/${workloadId}` },
    });
    expect(volume.spec?.claimRef).toEqual({
      namespace: `project-${projectId}`,
      name: claim.metadata?.name,
    });
    expect(claim.spec?.volumeName).toBe(volume.metadata?.name);
    // The Docker claim prune keys on this label; the site claim must lack it.
    expect(claim.metadata?.labels).not.toHaveProperty(
      'acceleratio.io/volume-id',
    );
  });

  it('serves the release from the read-only claim', () => {
    const deployment = buildDeployment({
      ...site,
      external_name: 'docs-3f9a1b2c',
      config: {
        docker_image: STATIC_SERVER_IMAGE,
        command: siteServerArgs(releaseId),
      },
      read_only_claim: { name: 'static-site-x', mount_path: '/site' },
      readiness_probe: SITE_READINESS_PROBE,
    });
    const pod = deployment.spec!.template.spec!;

    expect(pod.containers[0].readinessProbe?.httpGet).toEqual({
      path: '/',
      port: 80,
    });

    expect(pod.containers[0].args).toEqual([
      '--root',
      `/site/${releaseId}`,
      '--page404',
      `/site/${releaseId}/404.html`,
      '--ignore-hidden-files',
      'false',
    ]);
    expect(pod.containers[0].volumeMounts).toEqual([
      { name: 'files', mountPath: '/site', readOnly: true },
    ]);
    expect(pod.volumes).toEqual([
      {
        name: 'files',
        persistentVolumeClaim: { claimName: 'static-site-x', readOnly: true },
      },
    ]);
    // Read-only files never need the Recreate strategy volumes force.
    expect(deployment.spec?.strategy).toBeUndefined();
  });
});
