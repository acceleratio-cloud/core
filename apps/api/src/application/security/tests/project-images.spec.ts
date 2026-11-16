import type { V1Pod } from '@kubernetes/client-node';
import { WORKLOAD_ID_LABEL } from '../../workload/docker/docker-workload.manifests';
import {
  sbomDir,
  scanJob,
  scanMemoryLimit,
  scanTarget,
  scanTimeoutSeconds,
} from '../image-scan.manifests';
import { projectImages, type ProjectWorkloadRef } from '../project-images';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;

const pod = (
  workloadId: string | undefined,
  containers: { name: string; image: string; imageID: string }[],
): V1Pod => ({
  metadata: {
    name: 'pod',
    labels: workloadId ? { [WORKLOAD_ID_LABEL]: workloadId } : {},
  },
  spec: {
    containers: containers.map(({ name, image }) => ({ name, image })),
  },
  status: {
    containerStatuses: containers.map(({ name, imageID }) => ({
      name,
      image: imageID.split('@')[1],
      imageID,
      ready: true,
      restartCount: 0,
    })),
  },
});

const workloads: ProjectWorkloadRef[] = [
  { id: 'w-web', name: 'web', type: 'docker' },
  { id: 'w-db', name: 'db', type: 'postgres' },
];

describe('projectImages', () => {
  it('lists each service image once, with what the spec asked for', () => {
    const web = {
      name: 'main',
      image: 'nginx:1.27',
      imageID: `docker.io/library/nginx@${DIGEST}`,
    };

    const images = projectImages(
      [
        pod('w-web', [web]),
        pod('w-web', [web]),
        pod('w-db', [
          {
            name: 'postgres',
            image: 'ghcr.io/cloudnative-pg/postgresql:17',
            imageID: `ghcr.io/cloudnative-pg/postgresql@${OTHER}`,
          },
        ]),
        pod(undefined, [web]),
        pod('w-gone', [web]),
      ],
      workloads,
    );

    expect(images).toEqual([
      {
        workload_id: 'w-db',
        workload_name: 'db',
        container: 'postgres',
        image: 'ghcr.io/cloudnative-pg/postgresql:17',
        digest: OTHER,
        image_id: `ghcr.io/cloudnative-pg/postgresql@${OTHER}`,
        managed: true,
      },
      {
        workload_id: 'w-web',
        workload_name: 'web',
        container: 'main',
        image: 'nginx:1.27',
        digest: DIGEST,
        image_id: `docker.io/library/nginx@${DIGEST}`,
        managed: false,
      },
    ]);
  });

  it('skips containers whose image has not been pulled yet', () => {
    expect(
      projectImages(
        [pod('w-web', [{ name: 'main', image: 'nginx', imageID: '' }])],
        workloads,
      ),
    ).toEqual([]);
  });

  it('skips pods that ended or are leaving', () => {
    const web = {
      name: 'main',
      image: 'nginx:1.27',
      imageID: `docker.io/library/nginx@${DIGEST}`,
    };
    const evicted = pod('w-web', [web]);
    const leaving = pod('w-web', [web]);

    evicted.status!.phase = 'Failed';
    leaving.metadata!.deletionTimestamp = new Date();

    expect(projectImages([evicted, leaving], workloads)).toEqual([]);
  });
});

describe('scanTarget', () => {
  it('pulls built images through the registry cluster DNS name', () => {
    expect(
      scanTarget(`registry.acceleratio.internal/project/service@${DIGEST}`),
    ).toEqual({
      ref: `registry.acceleratio.svc.cluster.local:5000/project/service@${DIGEST}`,
      insecure: true,
    });
  });

  it('keeps other registries and refuses anything but repository@digest', () => {
    expect(scanTarget(`docker.io/library/nginx@${DIGEST}`)).toEqual({
      ref: `docker.io/library/nginx@${DIGEST}`,
      insecure: false,
    });
    expect(scanTarget(`docker-pullable://nginx@${DIGEST}`)?.ref).toBe(
      `nginx@${DIGEST}`,
    );
    expect(scanTarget('nginx:latest')).toBeNull();
    expect(scanTarget(`--config=/etc/x@${DIGEST}`)).toBeNull();
  });
});

describe('scan Job settings', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('reads the memory limit and timeout, falling back on bad values', () => {
    process.env.SCAN_MEMORY_LIMIT = '2Gi';
    process.env.SCAN_TIMEOUT_MINUTES = '45';
    expect(scanMemoryLimit()).toEqual({
      quantity: '2Gi',
      bytes: 2 * 1024 ** 3,
    });
    expect(scanTimeoutSeconds()).toBe(45 * 60);

    process.env.SCAN_MEMORY_LIMIT = '100Mi';
    process.env.SCAN_TIMEOUT_MINUTES = '0';
    expect(scanMemoryLimit().quantity).toBe('1Gi');
    expect(scanTimeoutSeconds()).toBe(20 * 60);
  });

  it('keeps SBOMs per scanner version', () => {
    expect(sbomDir()).toBe('/cache/sbom/0.76.2');
    process.env.SCANNER_IMAGE = 'mirror.local/trivy@sha256:abc';
    expect(sbomDir()).toBe('/cache/sbom/custom');
  });

  it('runs locked down, with Go told about the memory limit', () => {
    const job = scanJob({
      scanId: 'id',
      name: 'scan-x',
      namespace: 'acceleratio-security',
      digest: DIGEST,
      ref: `nginx@${DIGEST}`,
      insecure: false,
    });
    const container = job.spec!.template.spec!.containers[0];
    const envOf = (name: string) =>
      container.env?.find((item) => item.name === name)?.value;

    expect(container.securityContext).toMatchObject({
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
    });
    expect(container.resources?.limits?.memory).toBe('1Gi');
    expect(envOf('GOMEMLIMIT')).toBe(String(Math.floor(1024 ** 3 * 0.85)));
    expect(envOf('SCAN_DIGEST')).toBe(DIGEST);
    expect(job.spec!.activeDeadlineSeconds).toBe(20 * 60);
    expect(container.command?.[2]).toContain('--parallel=1');
    expect(container.command?.[2]).toContain('trivy sbom');
  });
});
