import type {
  DeploymentOptions,
  WorkloadManifestInput,
} from '../docker-workload.manifests';
import {
  ALWAYS_PULL_POLICY,
  buildDeployment,
  CPU_LIMIT,
  CPU_REQUEST,
  DEFAULT_REPLICAS,
  IF_NOT_PRESENT_PULL_POLICY,
  imagePullPolicy,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  MEMORY_LIMIT,
  MEMORY_REQUEST,
  PROGRESS_DEADLINE_SECONDS,
  PROJECT_ID_LABEL,
  RESTARTED_AT_ANNOTATION,
  REVISION_HISTORY_LIMIT,
  TERMINATION_GRACE_PERIOD_SECONDS,
  WORKLOAD_ID_LABEL,
  WORKLOAD_NAME_ANNOTATION,
} from '../docker-workload.manifests';

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const namespace = `project-${projectId}`;

const input: WorkloadManifestInput = {
  id: workloadId,
  project_id: projectId,
  name: 'My API',
  external_name: 'my-api-3f9a1b2c',
  config: { docker_image: 'nginx:1.25' },
};

const containerOf = (options?: DeploymentOptions) => {
  const deployment = buildDeployment(input, options);

  return deployment.spec?.template?.spec?.containers?.[0];
};

describe('imagePullPolicy', () => {
  it.each([
    ['nginx', ALWAYS_PULL_POLICY],
    ['nginx:latest', ALWAYS_PULL_POLICY],
    ['registry.local:5000/nginx', ALWAYS_PULL_POLICY],
    ['registry.local:5000/nginx:latest', ALWAYS_PULL_POLICY],
    ['nginx:1.25', IF_NOT_PRESENT_PULL_POLICY],
    ['registry.local:5000/nginx:1.25', IF_NOT_PRESENT_PULL_POLICY],
    ['nginx@sha256:abc123', IF_NOT_PRESENT_PULL_POLICY],
  ])('uses the right policy for %s', (image, expected) => {
    expect(imagePullPolicy(image)).toBe(expected);
  });
});

describe('buildDeployment', () => {
  it('names the Deployment after the immutable external name', () => {
    const deployment = buildDeployment(input);

    expect(deployment.metadata).toMatchObject({
      name: input.external_name,
      namespace,
      labels: {
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
        [PROJECT_ID_LABEL]: projectId,
        [WORKLOAD_ID_LABEL]: workloadId,
      },
      annotations: { [WORKLOAD_NAME_ANNOTATION]: input.name },
    });
  });

  it('uses a stable workload-id selector and the planned rollout settings', () => {
    const deployment = buildDeployment(input);

    expect(deployment.spec).toMatchObject({
      replicas: DEFAULT_REPLICAS,
      progressDeadlineSeconds: PROGRESS_DEADLINE_SECONDS,
      revisionHistoryLimit: REVISION_HISTORY_LIMIT,
      selector: { matchLabels: { [WORKLOAD_ID_LABEL]: workloadId } },
    });
    expect(deployment.spec?.template?.metadata?.labels).toEqual({
      [PROJECT_ID_LABEL]: projectId,
      [WORKLOAD_ID_LABEL]: workloadId,
    });
    expect(deployment.spec?.template?.metadata?.annotations).toEqual({
      [WORKLOAD_NAME_ANNOTATION]: input.name,
    });
    expect(deployment.spec?.template?.spec?.terminationGracePeriodSeconds).toBe(
      TERMINATION_GRACE_PERIOD_SECONDS,
    );
  });

  it('sets the image and resources and never declares a container port', () => {
    const container = containerOf();

    expect(container).toMatchObject({
      name: 'main',
      image: 'nginx:1.25',
      imagePullPolicy: IF_NOT_PRESENT_PULL_POLICY,
      resources: {
        requests: { cpu: CPU_REQUEST, memory: MEMORY_REQUEST },
        limits: { cpu: CPU_LIMIT, memory: MEMORY_LIMIT },
      },
    });
    expect(container?.ports).toBeUndefined();
  });

  it('maps the configured limits and keeps the default requests', () => {
    const container = buildDeployment({
      ...input,
      config: { docker_image: 'nginx:1.25', cpu_max: 0.5, ram_max: 512 },
    }).spec?.template?.spec?.containers?.[0];

    expect(container?.resources).toEqual({
      requests: { cpu: CPU_REQUEST, memory: MEMORY_REQUEST },
      limits: { cpu: '500m', memory: '512Mi' },
    });
  });

  it('renders whole cores and GiB in their short form', () => {
    const container = buildDeployment({
      ...input,
      config: { docker_image: 'nginx:1.25', cpu_max: 2, ram_max: 2048 },
    }).spec?.template?.spec?.containers?.[0];

    expect(container?.resources?.limits).toEqual({ cpu: '2', memory: '2Gi' });
  });

  it('lowers the requests to limits below them', () => {
    const container = buildDeployment({
      ...input,
      config: { docker_image: 'nginx:1.25', cpu_max: 0.05, ram_max: 64 },
    }).spec?.template?.spec?.containers?.[0];

    expect(container?.resources).toEqual({
      requests: { cpu: '50m', memory: '64Mi' },
      limits: { cpu: '50m', memory: '64Mi' },
    });
  });

  it('leaves a resource with a null limit unlimited', () => {
    const container = buildDeployment({
      ...input,
      config: { docker_image: 'nginx:1.25', cpu_max: null, ram_max: 512 },
    }).spec?.template?.spec?.containers?.[0];

    expect(container?.resources).toEqual({
      requests: { cpu: CPU_REQUEST, memory: MEMORY_REQUEST },
      limits: { memory: '512Mi' },
    });
  });

  it('declares no limits when both are null', () => {
    const container = buildDeployment({
      ...input,
      config: { docker_image: 'nginx:1.25', cpu_max: null, ram_max: null },
    }).spec?.template?.spec?.containers?.[0];

    expect(container?.resources).toEqual({
      requests: { cpu: CPU_REQUEST, memory: MEMORY_REQUEST },
    });
  });

  it('maps entrypoint to command and command to args', () => {
    const container = buildDeployment({
      ...input,
      config: {
        docker_image: 'nginx:1.25',
        entrypoint: ['sh', '-c'],
        command: ['echo hi && sleep 3600'],
      },
    }).spec?.template?.spec?.containers?.[0];

    expect(container?.command).toEqual(['sh', '-c']);
    expect(container?.args).toEqual(['echo hi && sleep 3600']);
  });

  it('keeps the image entrypoint and command when none are set', () => {
    const container = containerOf();

    expect(container).not.toHaveProperty('command');
    expect(container).not.toHaveProperty('args');
  });

  it('never declares a port for a latest image', () => {
    const deployment = buildDeployment({
      ...input,
      config: { docker_image: 'nginx:latest' },
    });
    const container = deployment.spec?.template?.spec?.containers?.[0];

    expect(container?.imagePullPolicy).toBe(ALWAYS_PULL_POLICY);
    expect(container?.ports).toBeUndefined();
  });

  it('applies overrides for replicas, restarts and a replace call', () => {
    const deployment = buildDeployment(input, {
      replicas: 0,
      restartedAt: '2026-11-02T10:00:00.000Z',
      resourceVersion: '42',
    });

    expect(deployment.metadata?.resourceVersion).toBe('42');
    expect(deployment.spec?.replicas).toBe(0);
    expect(
      deployment.spec?.template?.metadata?.annotations?.[
        RESTARTED_AT_ANNOTATION
      ],
    ).toBe('2026-11-02T10:00:00.000Z');
  });
});
