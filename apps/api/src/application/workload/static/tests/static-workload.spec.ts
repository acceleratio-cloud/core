import { BadRequestException } from '@nestjs/common';
import { buildDeployment } from '../../docker/docker-workload.manifests';
import {
  isServedPath,
  normalizeStaticConfig,
  releaseIdOf,
} from '../static-workload.config';
import {
  buildSiteFilesContainer,
  buildSiteKeySecret,
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
  const init = buildSiteFilesContainer({
    workloadId,
    releaseId,
    bucket: 'acceleratio-sites',
    endpoint: 'http://rustfs.rustfs.svc.cluster.local:9000',
    image: 'rustfs/rc:test',
  });

  it('copies its own release with the site key from its Secret', () => {
    expect(init.command?.[2]).toContain(
      `rc mirror --quiet site/acceleratio-sites/${workloadId}/${releaseId}/ /site/${releaseId}/`,
    );
    expect(init.envFrom).toEqual([
      { secretRef: { name: `static-site-${workloadId}` } },
    ]);
    expect(JSON.stringify(init)).not.toContain('AWS_SECRET_ACCESS_KEY":');
  });

  it('keeps the key Secret out of the Docker prune', () => {
    const secret = buildSiteKeySecret(site, {
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
    });

    expect(secret.metadata).toMatchObject({
      name: `static-site-${workloadId}`,
      namespace: `project-${projectId}`,
    });
    expect(secret.metadata?.labels).not.toHaveProperty(
      'acceleratio.io/workload-id',
    );
    expect(secret.stringData).toEqual({
      AWS_ACCESS_KEY_ID: 'AK',
      AWS_SECRET_ACCESS_KEY: 'SK',
    });
  });

  it('serves the release from an emptyDir the init container fills', () => {
    const deployment = buildDeployment({
      ...site,
      external_name: 'docs-3f9a1b2c',
      config: {
        docker_image: STATIC_SERVER_IMAGE,
        command: siteServerArgs(releaseId),
      },
      files: { mount_path: '/site', init },
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
    expect(pod.initContainers?.[0]).toMatchObject({
      name: 'fetch-files',
      volumeMounts: [{ name: 'files', mountPath: '/site' }],
    });
    expect(pod.volumes).toEqual([{ name: 'files', emptyDir: {} }]);
    // Copied files never need the Recreate strategy volumes force.
    expect(deployment.spec?.strategy).toBeUndefined();
  });
});
