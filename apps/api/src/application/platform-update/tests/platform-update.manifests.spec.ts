import { gzipSync } from 'node:zlib';
import type { V1Secret } from '@kubernetes/client-node';
import {
  LAUNCHER_CONTAINER,
  UPDATE_ID_LABEL,
  buildUpdateJob,
  readUpdateScripts,
  updateExternalName,
  type UpdateJobInput,
} from '../platform-update.manifests';
import { decodeHelmRelease } from '../platform-version.helm';

const input: UpdateJobInput = {
  id: '0b8f6c1e-4d2a-4c55-9a1e-2f3c4d5e6f70',
  name: 'platform-update-0b8f6c1e4d2a',
  namespace: 'acceleratio',
  image: 'ghcr.io/acceleratio-cloud/api:0.1.6',
  nodeName: 'server-1',
  targetVersion: '0.1.7',
  releaseUrl:
    'https://github.com/acceleratio-cloud/core/releases/download/v0.1.7',
  updateSha256: 'a'.repeat(64),
  installSha256: 'b'.repeat(64),
  configDir: '/etc/acceleratio',
  updateRoot: '/var/lib/acceleratio/updates',
};

describe('platform update manifests', () => {
  it('names the Job and ConfigMap after the update as a DNS label', () => {
    expect(updateExternalName(input.id)).toBe('platform-update-0b8f6c1e4d2a');
  });

  it('runs the launcher privileged with the host PID namespace on the server', () => {
    const job = buildUpdateJob(input);
    const pod = job.spec?.template.spec;
    const container = pod?.containers[0];

    expect(job.metadata).toMatchObject({
      name: input.name,
      namespace: 'acceleratio',
      labels: { [UPDATE_ID_LABEL]: input.id },
    });
    expect(job.spec).toMatchObject({ backoffLimit: 0 });
    expect(pod).toMatchObject({
      restartPolicy: 'Never',
      hostPID: true,
      nodeName: 'server-1',
      automountServiceAccountToken: false,
      tolerations: [{ operator: 'Exists' }],
    });
    expect(pod?.nodeSelector).toBeUndefined();
    expect(container?.name).toBe(LAUNCHER_CONTAINER);
    expect(container?.image).toBe(input.image);
    expect(container?.securityContext).toMatchObject({
      privileged: true,
      runAsUser: 0,
    });
    expect(container?.command?.[2]).toBe(readUpdateScripts().launcher);
  });

  it('passes the release, the checksums and the runner through the environment', () => {
    const env = Object.fromEntries(
      (buildUpdateJob(input).spec?.template.spec?.containers[0].env ?? []).map(
        (item) => [item.name, item.value],
      ),
    );

    expect(env).toMatchObject({
      UPDATE_ID: input.id,
      TARGET_VERSION: '0.1.7',
      RELEASE_URL: input.releaseUrl,
      UPDATE_SHA256: input.updateSha256,
      INSTALL_SHA256: input.installSha256,
      STATUS_NAMESPACE: 'acceleratio',
      STATUS_CONFIGMAP: input.name,
      CONFIG_DIR: '/etc/acceleratio',
      UPDATE_ROOT: '/var/lib/acceleratio/updates',
    });
    expect(env.RUNNER_SCRIPT).toBe(readUpdateScripts().runner);
  });

  it('falls back to the control-plane label when the server is unknown', () => {
    const pod = buildUpdateJob({ ...input, nodeName: null }).spec?.template
      .spec;

    expect(pod?.nodeName).toBeUndefined();
    expect(pod?.nodeSelector).toEqual({
      'node-role.kubernetes.io/control-plane': 'true',
    });
  });
});

describe('decodeHelmRelease', () => {
  const secretOf = (release: unknown): V1Secret => {
    const helm = gzipSync(Buffer.from(JSON.stringify(release))).toString(
      'base64',
    );
    return {
      metadata: { namespace: 'kube-system', labels: { name: 'cilium' } },
      data: { release: Buffer.from(helm).toString('base64') },
    };
  };

  it('reads the chart of a Helm release secret', () => {
    expect(
      decodeHelmRelease(
        secretOf({
          name: 'cilium',
          namespace: 'kube-system',
          chart: {
            metadata: {
              name: 'cilium',
              version: '1.18.2',
              appVersion: '1.18.2',
            },
          },
        }),
      ),
    ).toEqual({
      name: 'cilium',
      namespace: 'kube-system',
      chart: 'cilium',
      version: '1.18.2',
      appVersion: '1.18.2',
    });
  });

  it('returns null for an unreadable payload', () => {
    expect(decodeHelmRelease({ data: { release: 'bm90IGpzb24=' } })).toBeNull();
    expect(decodeHelmRelease({})).toBeNull();
  });
});
