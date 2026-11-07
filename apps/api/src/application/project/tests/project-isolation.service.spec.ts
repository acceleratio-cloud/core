import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { ProjectDnsService } from '../project-dns.service';
import {
  ISOLATION_POLICY_NAME,
  ProjectIsolationService,
} from '../project-isolation.service';

// The client-node package is ESM-only and Jest runs CommonJS. The service only
// needs the class token for constructor metadata; injection is manual here.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const namespace = `project-${projectId}`;
// Mirrors @kubernetes/client-node's ApiException without loading the ESM-only
// package in Jest.
const clusterError = (code: number) =>
  Object.assign(new Error(`Kubernetes ${code}`), { code, body: {} });
const notFound = () => clusterError(404);
const conflict = () => clusterError(409);

interface PolicyRequest {
  group: string;
  version: string;
  namespace: string;
  plural: string;
  name?: string;
  body: Record<string, unknown>;
}

const createService = () => {
  const coreV1 = {
    readNamespace: jest.fn(),
    createNamespace: jest.fn(),
    deleteNamespace: jest.fn(),
  };
  const customObjects = {
    getClusterCustomObject: jest.fn(),
    getNamespacedCustomObject: jest.fn(),
    createNamespacedCustomObject: jest.fn<Promise<unknown>, [PolicyRequest]>(),
    replaceNamespacedCustomObject: jest.fn<Promise<unknown>, [PolicyRequest]>(),
  };
  const kubernetes = {
    coreV1,
    customObjects,
  } as unknown as KubernetesService;

  const dns = { ensure: jest.fn().mockResolvedValue(undefined) };

  return {
    service: new ProjectIsolationService(
      kubernetes,
      dns as unknown as ProjectDnsService,
    ),
    coreV1,
    customObjects,
    dns,
  };
};

describe('ProjectIsolationService.ensure', () => {
  it('creates the namespace and the isolation policy', async () => {
    const { service, coreV1, customObjects } = createService();

    customObjects.getClusterCustomObject.mockResolvedValue({});
    coreV1.readNamespace.mockRejectedValue(notFound());
    coreV1.createNamespace.mockResolvedValue({});
    customObjects.getNamespacedCustomObject.mockRejectedValue(notFound());
    customObjects.createNamespacedCustomObject.mockResolvedValue({});

    await service.ensure(projectId);

    expect(customObjects.getClusterCustomObject).toHaveBeenCalledWith({
      group: 'apiextensions.k8s.io',
      version: 'v1',
      plural: 'customresourcedefinitions',
      name: 'ciliumnetworkpolicies.cilium.io',
    });
    expect(coreV1.createNamespace).toHaveBeenCalledWith({
      body: {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: namespace,
          labels: {
            'app.kubernetes.io/managed-by': 'acceleratio',
            'acceleratio.io/project-id': projectId,
          },
        },
      },
    });

    const createPolicy =
      customObjects.createNamespacedCustomObject.mock.calls[0][0];

    expect(createPolicy).toMatchObject({
      group: 'cilium.io',
      version: 'v2',
      namespace,
      plural: 'ciliumnetworkpolicies',
      body: {
        apiVersion: 'cilium.io/v2',
        kind: 'CiliumNetworkPolicy',
        metadata: { name: ISOLATION_POLICY_NAME, namespace },
      },
    });
    expect((createPolicy.body as { spec: unknown }).spec).toEqual({
      endpointSelector: { matchLabels: {} },
      enableDefaultDeny: { ingress: true, egress: true },
      ingress: [
        {
          fromEndpoints: [
            {
              matchLabels: {
                'k8s:io.kubernetes.pod.namespace': namespace,
              },
            },
          ],
        },
        { fromEntities: ['host', 'remote-node'] },
        {
          fromEndpoints: [
            {
              matchLabels: {
                'k8s:io.kubernetes.pod.namespace': 'kube-system',
                'app.kubernetes.io/name': 'traefik',
              },
            },
          ],
        },
      ],
      egress: [
        {
          toEndpoints: [
            {
              matchLabels: {
                'k8s:io.kubernetes.pod.namespace': namespace,
              },
            },
          ],
        },
        {
          toEndpoints: [
            {
              matchLabels: {
                'k8s:io.kubernetes.pod.namespace': 'kube-system',
                'k8s-app': 'kube-dns',
              },
            },
          ],
          toPorts: [
            {
              ports: [
                { port: '53', protocol: 'UDP' },
                { port: '53', protocol: 'TCP' },
              ],
            },
          ],
        },
        // Only the SeaweedFS S3 port, for project workloads using buckets.
        {
          toEndpoints: [
            {
              matchLabels: {
                'k8s:io.kubernetes.pod.namespace': 'seaweedfs',
                'app.kubernetes.io/name': 'seaweedfs',
                'app.kubernetes.io/component': 'filer',
              },
            },
          ],
          toPorts: [{ ports: [{ port: '8333', protocol: 'TCP' }] }],
        },
        { toEntities: ['world'] },
      ],
    });
  });

  it('is idempotent when the namespace and policy already exist', async () => {
    const { service, coreV1, customObjects } = createService();

    customObjects.getClusterCustomObject.mockResolvedValue({});
    coreV1.readNamespace.mockResolvedValue({ metadata: { name: namespace } });
    customObjects.getNamespacedCustomObject.mockResolvedValue({
      metadata: { resourceVersion: '77' },
    });
    customObjects.replaceNamespacedCustomObject.mockResolvedValue({});

    await service.ensure(projectId);

    expect(coreV1.createNamespace).not.toHaveBeenCalled();
    expect(customObjects.createNamespacedCustomObject).not.toHaveBeenCalled();
    expect(customObjects.replaceNamespacedCustomObject).toHaveBeenCalledTimes(
      1,
    );

    const replace =
      customObjects.replaceNamespacedCustomObject.mock.calls[0][0];

    expect(replace.name).toBe(ISOLATION_POLICY_NAME);
    expect(replace.body.metadata).toMatchObject({
      name: ISOLATION_POLICY_NAME,
      namespace,
      resourceVersion: '77',
    });
  });

  it('treats a concurrent namespace create as success', async () => {
    const { service, coreV1, customObjects } = createService();

    customObjects.getClusterCustomObject.mockResolvedValue({});
    coreV1.readNamespace.mockRejectedValue(notFound());
    coreV1.createNamespace.mockRejectedValue(conflict());
    customObjects.getNamespacedCustomObject.mockRejectedValue(notFound());
    customObjects.createNamespacedCustomObject.mockResolvedValue({});

    await expect(service.ensure(projectId)).resolves.toBeUndefined();
  });

  it('retries an update once when the policy was modified concurrently', async () => {
    const { service, coreV1, customObjects } = createService();

    customObjects.getClusterCustomObject.mockResolvedValue({});
    coreV1.readNamespace.mockResolvedValue({ metadata: { name: namespace } });
    customObjects.getNamespacedCustomObject
      .mockResolvedValueOnce({ metadata: { resourceVersion: '77' } })
      .mockResolvedValueOnce({ metadata: { resourceVersion: '78' } });
    customObjects.replaceNamespacedCustomObject
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({});

    await service.ensure(projectId);

    expect(customObjects.replaceNamespacedCustomObject).toHaveBeenCalledTimes(
      2,
    );

    const retry = customObjects.replaceNamespacedCustomObject.mock.calls[1][0]
      .body as { metadata: { resourceVersion: string } };

    expect(retry.metadata.resourceVersion).toBe('78');
  });

  it('fails with 503 when the Cilium CRD is missing', async () => {
    const { service, coreV1, customObjects } = createService();

    customObjects.getClusterCustomObject.mockRejectedValue(notFound());

    const failure = service.ensure(projectId);

    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(failure).rejects.toThrow(
      'CiliumNetworkPolicy CRD is not installed',
    );
    expect(coreV1.readNamespace).not.toHaveBeenCalled();
    expect(coreV1.createNamespace).not.toHaveBeenCalled();
  });
});

describe('ProjectIsolationService.remove', () => {
  it('succeeds when the namespace does not exist', async () => {
    const { service, coreV1 } = createService();

    coreV1.readNamespace.mockRejectedValue(notFound());

    await expect(service.remove(projectId)).resolves.toBeUndefined();
    expect(coreV1.deleteNamespace).not.toHaveBeenCalled();
  });

  it('succeeds without another delete call when the namespace is Terminating', async () => {
    const { service, coreV1 } = createService();

    coreV1.readNamespace.mockResolvedValue({
      metadata: { name: namespace, deletionTimestamp: new Date() },
    });

    await expect(service.remove(projectId)).resolves.toBeUndefined();
    expect(coreV1.deleteNamespace).not.toHaveBeenCalled();
  });

  it('deletes an active namespace', async () => {
    const { service, coreV1 } = createService();

    coreV1.readNamespace.mockResolvedValue({ metadata: { name: namespace } });
    coreV1.deleteNamespace.mockResolvedValue({});

    await service.remove(projectId);

    expect(coreV1.deleteNamespace).toHaveBeenCalledWith({ name: namespace });
  });

  it('treats a delete that raced with removal as success', async () => {
    const { service, coreV1 } = createService();

    coreV1.readNamespace.mockResolvedValue({ metadata: { name: namespace } });
    coreV1.deleteNamespace.mockRejectedValue(notFound());

    await expect(service.remove(projectId)).resolves.toBeUndefined();
  });

  it('propagates other Kubernetes errors', async () => {
    const { service, coreV1 } = createService();

    coreV1.readNamespace.mockResolvedValue({ metadata: { name: namespace } });
    coreV1.deleteNamespace.mockRejectedValue(clusterError(403));

    await expect(service.remove(projectId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('ProjectIsolationService private network', () => {
  const ensurePolicy = async () => {
    const { service, coreV1, customObjects, dns } = createService();

    customObjects.getClusterCustomObject.mockResolvedValue({});
    coreV1.readNamespace.mockResolvedValue({});
    customObjects.getNamespacedCustomObject.mockRejectedValue(notFound());
    customObjects.createNamespacedCustomObject.mockResolvedValue({});

    await service.ensure(projectId);

    const { spec } = customObjects.createNamespacedCustomObject.mock.calls[0][0]
      .body as {
      spec: {
        ingress: Array<Record<string, unknown>>;
        egress: Array<Record<string, unknown>>;
      };
    };

    return { spec, dns };
  };
  const ownNamespace = { 'k8s:io.kubernetes.pod.namespace': namespace };
  const namespaceOf = (rule: Record<string, unknown>, key: string) =>
    (
      rule[key] as Array<{ matchLabels: Record<string, string> }> | undefined
    )?.map(
      ({ matchLabels }) => matchLabels['k8s:io.kubernetes.pod.namespace'],
    ) ?? [];

  it('lets project pods reach each other on any port', async () => {
    const { spec } = await ensurePolicy();

    expect(spec.ingress).toContainEqual({
      fromEndpoints: [{ matchLabels: ownNamespace }],
    });
    expect(spec.egress).toContainEqual({
      toEndpoints: [{ matchLabels: ownNamespace }],
    });
  });

  it('opens nothing to pods of other projects', async () => {
    const { spec } = await ensurePolicy();
    const entities = [
      ...spec.ingress.flatMap(
        (rule) => (rule.fromEntities as string[] | undefined) ?? [],
      ),
      ...spec.egress.flatMap(
        (rule) => (rule.toEntities as string[] | undefined) ?? [],
      ),
    ];
    const namespaces = [
      ...spec.ingress.flatMap((rule) => namespaceOf(rule, 'fromEndpoints')),
      ...spec.egress.flatMap((rule) => namespaceOf(rule, 'toEndpoints')),
    ];

    // `world` is outside the cluster; `cluster` and `all` would include pods
    // of every other project.
    expect(entities).not.toContain('cluster');
    expect(entities).not.toContain('all');
    expect(namespaces.every((value) => value !== undefined)).toBe(true);
    expect(namespaces.filter((value) => value.startsWith('project-'))).toEqual([
      namespace,
      namespace,
    ]);
  });

  it('writes the private DNS rule', async () => {
    const { dns } = await ensurePolicy();

    expect(dns.ensure).toHaveBeenCalledTimes(1);
  });
});
