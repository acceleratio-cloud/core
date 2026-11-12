import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { V1Pod } from '@kubernetes/client-node';
import type {
  DeleteNodePayload,
  DrainNodePayload,
  NodeDrainPlan,
  NodeOperation,
  NodeOperationType,
} from '@acceleratio/shared';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import { NodeService } from './node.service';
import {
  buildDrainPlan,
  LONGHORN_NAMESPACE,
  type LonghornReplica,
  type LonghornVolume,
} from './node-drain-plan';
import { PRIVILEGED_SHELL, uninstallScript } from './node-join-script';
import { NodeOperationStore } from './node-operation.store';
import { createRedactor, SshConnector, validateSshAccess } from './node-ssh';
import type { SshSession, ValidSshAccess } from './node-ssh';

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 3600;
const POLL_MS = 2000;
const UNINSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const CONTROL_PLANE_ROLES = ['control-plane', 'master'];

interface DrainOptions {
  force: boolean;
  timeoutSeconds: number;
}

@Injectable()
export class NodeDrainService {
  private readonly logger = new Logger(NodeDrainService.name);

  constructor(
    private readonly kubernetes: KubernetesService,
    private readonly nodes: NodeService,
    private readonly operations: NodeOperationStore,
    private readonly connector: SshConnector,
  ) {}

  async plan(node: string): Promise<NodeDrainPlan> {
    await this.nodes.get(node);

    const [nodes, pods, budgets, volumes, longhornReplicas, longhornVolumes] =
      await Promise.all([
        this.kubernetes.coreV1.listNode(),
        this.kubernetes.coreV1.listPodForAllNamespaces({
          fieldSelector: `spec.nodeName=${node}`,
        }),
        this.kubernetes.policyV1.listPodDisruptionBudgetForAllNamespaces(),
        this.kubernetes.coreV1.listPersistentVolume(),
        this.listLonghorn<LonghornReplica>('replicas'),
        this.listLonghorn<LonghornVolume>('volumes'),
      ]);

    return buildDrainPlan({
      node,
      nodes: nodes.items,
      pods: pods.items,
      budgets: budgets.items,
      volumes: volumes.items,
      longhornReplicas,
      longhornVolumes,
    });
  }

  /** Longhorn objects of a kind; none when Longhorn is not installed. */
  private async listLonghorn<T>(plural: string): Promise<T[]> {
    try {
      const list =
        (await this.kubernetes.customObjects.listNamespacedCustomObject({
          group: 'longhorn.io',
          version: 'v1beta2',
          namespace: LONGHORN_NAMESPACE,
          plural,
        })) as { items?: T[] };

      return list.items ?? [];
    } catch {
      return [];
    }
  }

  /** The newest operation for a node, running or finished. */
  current(node: string): Promise<NodeOperation> {
    return this.operations.current(node);
  }

  history(node: string): Promise<NodeOperation[]> {
    return this.operations.history(node);
  }

  async drain(
    node: string,
    payload: DrainNodePayload | undefined,
    actor: string | null,
  ): Promise<NodeOperation> {
    const options = this.normalize(payload);
    const plan = await this.plan(node);

    if (!options.force && plan.drain_blockers.length > 0) {
      throw new ConflictException(
        `Drain is blocked: ${plan.drain_blockers.join('; ')}`,
      );
    }

    return this.start(node, 'drain', plan, options, actor);
  }

  async remove(
    node: string,
    payload: DeleteNodePayload | undefined,
    actor: string | null,
  ): Promise<NodeOperation> {
    if (payload?.confirm_name !== node) {
      throw new BadRequestException('Type the node name to confirm removal');
    }

    const options = this.normalize(payload);
    const access = payload.ssh ? validateSshAccess(payload.ssh) : undefined;
    const plan = await this.plan(node);
    const blockers = [
      ...plan.delete_blockers,
      ...(options.force ? [] : plan.drain_blockers),
    ];

    if (blockers.length > 0) {
      throw new ConflictException(`Removal is blocked: ${blockers.join('; ')}`);
    }

    return this.start(node, 'remove', plan, options, actor, access);
  }

  private async start(
    node: string,
    type: NodeOperationType,
    plan: NodeDrainPlan,
    options: DrainOptions,
    actor: string | null,
    access?: ValidSshAccess,
  ): Promise<NodeOperation> {
    const operation = await this.operations.start(
      node,
      type,
      actor,
      plan.pods.filter((pod) => this.shouldEvict(pod.action, options.force))
        .length,
    );

    void this.run(operation.id, node, options, type === 'remove', access);

    return operation;
  }

  private shouldEvict(action: string, force: boolean): boolean {
    return action === 'evict' || (force && action === 'blocked');
  }

  private async run(
    id: string,
    node: string,
    options: DrainOptions,
    remove: boolean,
    access: ValidSshAccess | undefined,
  ): Promise<void> {
    try {
      await this.operations.update(id, {
        step: 'cordon',
        message: 'Cordoning node',
      });
      const target = await this.nodes.setSchedulable(node, false);
      // No kubelet answers on a NotReady node, so pods there never finish
      // terminating; waiting for them would always end in a timeout.
      const reachable = target.status === 'Ready';
      const controlPlane = target.roles.some((role) =>
        CONTROL_PLANE_ROLES.includes(role),
      );

      await this.operations.update(id, {
        step: 'evict',
        message: 'Evicting pods',
      });

      if (!reachable) {
        await this.operations.log(
          id,
          'Node is not Ready: pods are deleted without waiting; they finish when the server returns or the node is deleted',
        );
      }

      const stuck = await this.evictAll(id, node, options, reachable);

      if (stuck.length > 0) {
        await this.operations.update(id, {
          status: 'failed',
          stuck,
          message:
            'Some pods did not leave the node; it stays cordoned until you uncordon it',
        });
        return;
      }

      if (remove) {
        await this.removeNode(id, node, controlPlane, access);
        return;
      }

      await this.operations.update(id, {
        status: 'succeeded',
        step: null,
        message: 'Node drained',
      });
    } catch (error) {
      this.logger.warn(
        `Operation on ${node} failed: ${(error as Error).message}`,
      );
      await this.operations
        .update(id, {
          status: 'failed',
          message: 'The operation failed; check the node state',
        })
        .catch(() => undefined);
    }
  }

  /**
   * Agents: k3s is uninstalled first, since a running kubelet registers a
   * deleted Node again. Control-plane servers: the Node is deleted first, so
   * k3s removes the etcd member while it still runs; stopping it first would
   * take a two-server etcd below quorum before the delete could be written.
   * The removed member's k3s then cannot rejoin, so it does not come back.
   */
  private async removeNode(
    id: string,
    node: string,
    controlPlane: boolean,
    access: ValidSshAccess | undefined,
  ): Promise<void> {
    if (access && !controlPlane) {
      const failure = await this.uninstall(id, access);

      if (failure) {
        await this.operations.update(id, {
          status: 'failed',
          message: `${failure}; the node is drained and cordoned but stays in the cluster`,
        });
        return;
      }
    }

    await this.operations.update(id, {
      step: 'delete',
      message: 'Removing node from the cluster',
    });
    await this.kubernetes.coreV1.deleteNode({ name: node });
    await this.operations.log(id, 'Node deleted from the cluster');

    let message = 'Node removed from the cluster';

    if (access && controlPlane) {
      const failure = await this.uninstall(id, access);

      message = failure
        ? `Node removed from the cluster, but ${failure}; clean up the server manually`
        : 'Node removed from the cluster and k3s uninstalled';
    } else if (access) {
      message = 'k3s uninstalled and node removed from the cluster';
    } else if (!controlPlane) {
      await this.operations.log(
        id,
        'No SSH access given: k3s still runs on the server and registers the node again until it is stopped or uninstalled',
      );
      message =
        'Node removed from the cluster; stop k3s on the server or it rejoins';
    }

    await this.operations.update(id, {
      status: 'succeeded',
      step: null,
      message,
    });
  }

  /** Uninstalls k3s over SSH; resolves with why it failed, or null. */
  private async uninstall(
    id: string,
    access: ValidSshAccess,
  ): Promise<string | null> {
    const redact = createRedactor([access.passphrase, access.privateKey]);
    let session: SshSession | undefined;

    await this.operations.update(id, {
      step: 'uninstall',
      message: 'Uninstalling k3s from the server',
    });

    try {
      session = await this.connector.connect(access);
      await this.operations.log(id, `Host key ${session.hostKey}`);

      const code = await session.run(PRIVILEGED_SHELL, {
        stdin: uninstallScript(),
        onLine: (line) =>
          void this.operations.log(id, redact(line)).catch(() => undefined),
        timeoutMs: UNINSTALL_TIMEOUT_MS,
      });

      return code === 0 ? null : `k3s uninstall exited with code ${code}`;
    } catch (error) {
      const message = `Uninstall over SSH failed: ${redact((error as Error).message)}`;

      await this.operations.log(id, message).catch(() => undefined);

      return message;
    } finally {
      session?.close();
    }
  }

  private async evictAll(
    id: string,
    node: string,
    options: DrainOptions,
    reachable: boolean,
  ): Promise<string[]> {
    const deadline = Date.now() + options.timeoutSeconds * 1000;
    const evicted = new Set<string>();
    let evictedCount = 0;

    for (;;) {
      const { items } = await this.kubernetes.coreV1.listPodForAllNamespaces({
        fieldSelector: `spec.nodeName=${node}`,
      });
      // On a NotReady node a terminating pod is as far as it can get: it is
      // garbage collected once the Node is deleted, or ends when it returns.
      const pods = items.filter(
        (pod) =>
          this.isEvictable(pod, options.force) &&
          (reachable || !pod.metadata?.deletionTimestamp),
      );

      await this.operations.update(id, {
        remaining: pods.length,
        evicted: evictedCount,
      });

      if (pods.length === 0) {
        return [];
      }

      if (Date.now() >= deadline) {
        return pods.map((pod) => this.key(pod));
      }

      for (const pod of pods) {
        const key = this.key(pod);

        if (evicted.has(key) || pod.metadata?.deletionTimestamp) {
          continue;
        }

        try {
          await this.evictPod(pod, reachable);
          evicted.add(key);
          evictedCount += 1;
          await this.operations.log(
            id,
            reachable ? `Evicted ${key}` : `Deleted ${key}`,
          );
        } catch (error) {
          // 429: a PodDisruptionBudget refuses for now; retry until timeout.
          const code = getKubernetesStatusCode(error);

          if (code !== 429 && code !== 404 && code !== 409) {
            throw error;
          }
        }
      }

      await this.sleep(POLL_MS);
    }
  }

  /**
   * Evictions respect PodDisruptionBudgets. Pods of a NotReady node already
   * stopped serving, and a budget may refuse them forever, so they are
   * deleted directly instead.
   */
  private async evictPod(pod: V1Pod, reachable: boolean): Promise<void> {
    const name = pod.metadata?.name ?? '';
    const namespace = pod.metadata?.namespace ?? '';

    if (!reachable) {
      await this.kubernetes.coreV1.deleteNamespacedPod({ name, namespace });
      return;
    }

    await this.kubernetes.coreV1.createNamespacedPodEviction({
      name,
      namespace,
      body: {
        apiVersion: 'policy/v1',
        kind: 'Eviction',
        metadata: { name, namespace },
      },
    });
  }

  private isEvictable(pod: V1Pod, force: boolean): boolean {
    const plan = buildDrainPlan({
      node: pod.spec?.nodeName ?? '',
      nodes: [],
      pods: [pod],
      budgets: [],
      volumes: [],
      longhornReplicas: [],
      longhornVolumes: [],
    });

    return this.shouldEvict(plan.pods[0]?.action ?? 'skip', force);
  }

  private key(pod: V1Pod): string {
    return `${pod.metadata?.namespace}/${pod.metadata?.name}`;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalize(payload: DrainNodePayload | undefined): DrainOptions {
    const timeout = payload?.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;

    if (
      !Number.isInteger(timeout) ||
      timeout < 10 ||
      timeout > MAX_TIMEOUT_SECONDS
    ) {
      throw new BadRequestException('Timeout must be 10 to 3600 seconds');
    }

    return { force: payload?.force === true, timeoutSeconds: timeout };
  }
}
