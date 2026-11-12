import { ConflictException } from '@nestjs/common';
import type { V1Node, V1Pod } from '@kubernetes/client-node';
import {
  buildDrainPlan,
  type LonghornReplica,
  type LonghornVolume,
} from '../node-drain-plan';
import { NodeDrainService } from '../node-drain.service';
import { PRIVILEGED_SHELL } from '../node-join-script';
import { FakeConnector, FakeOperationStore } from './fakes';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const pod = (
  name: string,
  extra: Partial<V1Pod> & {
    owner?: string;
    labels?: Record<string, string>;
  } = {},
): V1Pod => ({
  metadata: {
    name,
    namespace: 'default',
    labels: extra.labels ?? { app: name },
    ownerReferences:
      extra.owner === undefined
        ? [
            {
              apiVersion: 'v1',
              kind: 'ReplicaSet',
              name: 'rs',
              uid: 'u',
              controller: true,
            },
          ]
        : extra.owner
          ? [
              {
                apiVersion: 'v1',
                kind: extra.owner,
                name: 'o',
                uid: 'u',
                controller: true,
              },
            ]
          : [],
  },
  spec: { nodeName: 'n1', containers: [], volumes: extra.spec?.volumes },
  status: { phase: 'Running' },
});

const node = (name: string, controlPlane = false, ready = true): V1Node => ({
  metadata: {
    name,
    labels: controlPlane
      ? { 'node-role.kubernetes.io/control-plane': 'true' }
      : {},
  },
  status: {
    conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
  },
});

const input = (pods: V1Pod[], nodes = [node('n1', true), node('n2')]) => ({
  node: 'n1',
  nodes,
  pods,
  budgets: [],
  volumes: [],
  longhornReplicas: [] as LonghornReplica[],
  longhornVolumes: [] as LonghornVolume[],
});

describe('buildDrainPlan', () => {
  it('classifies pods', () => {
    const plan = buildDrainPlan(
      input([
        pod('web'),
        pod('ds', { owner: 'DaemonSet' }),
        pod('bare', { owner: '' }),
        pod('cache', {
          spec: { volumes: [{ name: 'v', emptyDir: {} }] } as never,
        }),
      ]),
    );

    expect(plan.pods.map((item) => [item.name, item.action])).toEqual([
      ['web', 'evict'],
      ['ds', 'skip'],
      ['bare', 'blocked'],
      ['cache', 'blocked'],
    ]);
    expect(plan.drain_blockers).toHaveLength(2);
  });

  it('flags pods whose budget allows no disruption', () => {
    const plan = buildDrainPlan({
      ...input([pod('web')]),
      budgets: [
        {
          metadata: { namespace: 'default' },
          spec: { selector: { matchLabels: { app: 'web' } } },
          status: { disruptionsAllowed: 0 },
        },
      ],
    });

    expect(plan.pods[0].pdb_blocked).toBe(true);
  });

  it('refuses removing the last control plane', () => {
    const plan = buildDrainPlan(input([], [node('n1', true), node('n2')]));

    expect(plan.delete_blockers).toContain(
      'This is the last control plane node',
    );
    expect(
      buildDrainPlan(input([], [node('n1', true), node('n2', true)]))
        .delete_blockers,
    ).toEqual([]);
  });

  it('refuses removing the only server', () => {
    const plan = buildDrainPlan(input([], [node('n1', true)]));

    expect(plan.delete_blockers).toContain(
      'This is the only server in the cluster',
    );
  });

  it('explains a volume whose only healthy copy is on the node without blocking removal', () => {
    const replica = (volume: string, node: string, healthy = true) => ({
      spec: {
        volumeName: volume,
        nodeID: node,
        healthyAt: '2026-11-12T10:00:00Z',
        failedAt: healthy ? '' : '2026-11-12T11:00:00Z',
      },
    });
    const plan = buildDrainPlan({
      ...input([], [node('n1'), node('n2', true)]),
      longhornReplicas: [
        replica('pvc-a', 'n1'),
        replica('pvc-a', 'n2', false),
        replica('pvc-b', 'n1'),
        replica('pvc-b', 'n2'),
      ],
      longhornVolumes: [
        {
          metadata: { name: 'pvc-a' },
          status: {
            kubernetesStatus: { namespace: 'project-1', pvcName: 'db' },
          },
        },
      ],
    });

    expect(plan.storage).toEqual([
      expect.objectContaining({
        kind: 'longhorn_replica',
        namespace: 'project-1',
        name: 'db',
      }),
    ]);
    expect(plan.storage[0].reason).toContain('copies it to another server');
    expect(plan.delete_blockers).toEqual([]);
  });

  it('blocks removal of a node that is down with the last copy of a volume', () => {
    const plan = buildDrainPlan({
      ...input([], [node('n1', false, false), node('n2', true)]),
      longhornReplicas: [
        { spec: { volumeName: 'pvc-a', nodeID: 'n1', healthyAt: 'x' } },
      ],
    });

    expect(plan.delete_blockers).toEqual([
      expect.stringContaining('The only healthy copy of this volume'),
    ]);
  });

  it('evicts Longhorn pods and static site pods despite their local volumes', () => {
    const manager = pod('instance-manager-1', {
      owner: '',
      spec: {
        containers: [],
        volumes: [{ name: 'dev', hostPath: { path: '/dev' } }],
      },
    });
    const site = pod('site-1', {
      labels: { 'acceleratio.io/workload-id': 'w1' },
      spec: { containers: [], volumes: [{ name: 'files', emptyDir: {} }] },
    });

    manager.metadata!.namespace = 'longhorn-system';

    const plan = buildDrainPlan(input([manager, site]));

    expect(plan.pods.map((item) => item.action)).toEqual(['evict', 'evict']);
  });
});

describe('NodeDrainService', () => {
  const build = (
    evictions: Array<unknown>,
    target: { status: string; roles: string[] } = {
      status: 'Ready',
      roles: [],
    },
  ) => {
    const running = pod('web');
    const remaining = [running];
    const coreV1 = {
      listNode: jest
        .fn()
        .mockResolvedValue({ items: [node('n1'), node('n2', true)] }),
      listPodForAllNamespaces: jest.fn(() =>
        Promise.resolve({ items: [...remaining] }),
      ),
      listPersistentVolume: jest.fn().mockResolvedValue({ items: [] }),
      createNamespacedPodEviction: jest.fn(() => {
        const next = evictions.shift();

        if (next) {
          return Promise.reject(Object.assign(new Error('refused'), next));
        }

        remaining.length = 0;

        return Promise.resolve();
      }),
      deleteNamespacedPod: jest.fn(() => {
        // The pod only gets marked: no kubelet confirms on a NotReady node.
        remaining.forEach((item) => {
          item.metadata!.deletionTimestamp = new Date();
        });

        return Promise.resolve({});
      }),
      deleteNode: jest.fn().mockResolvedValue({}),
    };
    const kubernetes = {
      coreV1,
      policyV1: {
        listPodDisruptionBudgetForAllNamespaces: jest
          .fn()
          .mockResolvedValue({ items: [] }),
      },
    };
    const nodes = {
      get: jest.fn().mockResolvedValue({}),
      setSchedulable: jest.fn().mockResolvedValue(target),
    };
    const store = new FakeOperationStore();
    const connector = new FakeConnector();
    const service = new NodeDrainService(
      kubernetes as never,
      nodes as never,
      store as never,
      connector,
    );

    jest.spyOn(service as never, 'sleep').mockResolvedValue(undefined as never);

    return { service, coreV1, nodes, store, connector };
  };

  it('retries an eviction refused by a budget, then drains', async () => {
    const { service, coreV1, nodes, store } = build([{ code: 429 }]);

    await service.drain('n1', {}, 'admin@example.com');
    const result = await store.settled('n1');

    expect(nodes.setSchedulable).toHaveBeenCalledWith('n1', false);
    expect(coreV1.createNamespacedPodEviction).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('succeeded');
    expect(result.actor).toBe('admin@example.com');
    expect(coreV1.deleteNode).not.toHaveBeenCalled();
  });

  it('requires the node name to remove and deletes the node afterwards', async () => {
    const { service, coreV1, connector, store } = build([]);

    await expect(
      service.remove('n1', { confirm_name: 'other' }, null),
    ).rejects.toThrow('Type the node name');

    await service.remove('n1', { confirm_name: 'n1' }, null);
    const result = await store.settled('n1');

    expect(result.status).toBe('succeeded');
    expect(coreV1.deleteNode).toHaveBeenCalledWith({ name: 'n1' });
    expect(connector.commands).toEqual([]);
  });

  it('uninstalls k3s over SSH before deleting the node and never stores the key', async () => {
    const { service, store, connector, coreV1 } = build([]);
    const key =
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabcdefghijkl\n-----END OPENSSH PRIVATE KEY-----';

    connector.output = ['using key abcdefghijkl'];

    await service.remove(
      'n1',
      {
        confirm_name: 'n1',
        ssh: { host: '10.0.0.5', username: 'root', private_key: key },
      },
      null,
    );
    const result = await store.settled('n1');

    expect(result.status).toBe('succeeded');
    expect(connector.commands).toEqual([PRIVILEGED_SHELL]);
    expect(connector.stdin[0]).toContain('k3s-agent-uninstall.sh');
    expect(JSON.stringify(result)).not.toContain('abcdefghijkl');
    expect(result.log.indexOf('Node deleted from the cluster')).toBeGreaterThan(
      result.log.findIndex((line) => line.startsWith('Host key')),
    );
    expect(coreV1.deleteNode).toHaveBeenCalledWith({ name: 'n1' });
  });

  it.each([
    ['the SSH connection fails', { failConnect: true }, 'connection refused'],
    ['the uninstall exits non-zero', { exitCode: 1 }, 'exited with code 1'],
  ])('keeps the node in the cluster when %s', async (_case, setup, reason) => {
    const { service, store, connector, coreV1 } = build([]);

    Object.assign(connector, setup);

    await service.remove(
      'n1',
      {
        confirm_name: 'n1',
        ssh: {
          host: '10.0.0.5',
          username: 'root',
          private_key:
            '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
        },
      },
      null,
    );
    const result = await store.settled('n1');

    expect(result.status).toBe('failed');
    expect(result.message).toContain(reason);
    expect(result.message).toContain('stays in the cluster');
    expect(coreV1.deleteNode).not.toHaveBeenCalled();
  });

  const sshKey =
    '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----';

  it.each([
    ['an agent', [], false],
    ['a control-plane server', ['control-plane', 'etcd'], true],
  ])(
    'orders uninstall and delete for %s',
    async (_case, roles, deleteFirst) => {
      const { service, store, connector, coreV1 } = build([], {
        status: 'Ready',
        roles,
      });
      let deletedBeforeUninstall: boolean | undefined;

      connector.outputFor = () => {
        deletedBeforeUninstall = coreV1.deleteNode.mock.calls.length > 0;
        return [];
      };

      await service.remove(
        'n1',
        {
          confirm_name: 'n1',
          ssh: { host: '10.0.0.5', username: 'root', private_key: sshKey },
        },
        null,
      );
      const result = await store.settled('n1');

      expect(result.status).toBe('succeeded');
      expect(deletedBeforeUninstall).toBe(deleteFirst);
      expect(coreV1.deleteNode).toHaveBeenCalledWith({ name: 'n1' });
    },
  );

  it('removes a control-plane server even when the uninstall fails', async () => {
    const { service, store, connector, coreV1 } = build([], {
      status: 'Ready',
      roles: ['control-plane'],
    });

    connector.failConnect = true;

    await service.remove(
      'n1',
      {
        confirm_name: 'n1',
        ssh: { host: '10.0.0.5', username: 'root', private_key: sshKey },
      },
      null,
    );
    const result = await store.settled('n1');

    expect(result.status).toBe('succeeded');
    expect(result.message).toContain('clean up the server manually');
    expect(coreV1.deleteNode).toHaveBeenCalled();
  });

  it('removes a NotReady node without waiting for its pods', async () => {
    const { service, store, coreV1 } = build([{ code: 429 }], {
      status: 'NotReady',
      roles: [],
    });

    await service.remove('n1', { confirm_name: 'n1' }, null);
    const result = await store.settled('n1');

    expect(result.status).toBe('succeeded');
    // Deleted directly: a budget would refuse the eviction forever.
    expect(coreV1.createNamespacedPodEviction).not.toHaveBeenCalled();
    expect(coreV1.deleteNamespacedPod).toHaveBeenCalledWith({
      name: 'web',
      namespace: 'default',
    });
    expect(coreV1.deleteNode).toHaveBeenCalledWith({ name: 'n1' });
  });

  it('rejects a second operation on a node', async () => {
    const { service } = build([]);

    await service.drain('n1', {}, null);
    await expect(service.drain('n1', {}, null)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
