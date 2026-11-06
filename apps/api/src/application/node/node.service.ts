import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { V1Node, V1Pod } from '@kubernetes/client-node';
import type {
  ClusterNode,
  ClusterNodeStatus,
  ClusterNodeTaint,
  UpdateNodeLabelsPayload,
  UpdateNodeTaintsPayload,
} from '@acceleratio/shared';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import {
  isReservedKey,
  normalizeLabels,
  normalizeTaints,
} from './node-metadata';

const TAINT_EFFECTS = ['NoSchedule', 'PreferNoSchedule', 'NoExecute'] as const;

const isActivePod = (pod: V1Pod): boolean =>
  pod.status?.phase !== 'Succeeded' && pod.status?.phase !== 'Failed';

@Injectable()
export class NodeService {
  private readonly logger = new Logger(NodeService.name);

  constructor(private readonly kubernetes: KubernetesService) {}

  async list(): Promise<ClusterNode[]> {
    try {
      const [{ items }, podCounts] = await Promise.all([
        this.kubernetes.coreV1.listNode(),
        this.countPodsByNode(),
      ]);

      return items.map((node) =>
        this.toClusterNode(node, podCounts.get(node.metadata?.name ?? '') ?? 0),
      );
    } catch (error) {
      throw this.toException(error, 'list cluster nodes');
    }
  }

  async get(name: string): Promise<ClusterNode> {
    try {
      const node = await this.kubernetes.coreV1.readNode({ name });

      return this.toClusterNode(node, await this.countPods(name));
    } catch (error) {
      throw this.toException(error, `read node ${name}`);
    }
  }

  async setSchedulable(
    name: string,
    schedulable: boolean,
  ): Promise<ClusterNode> {
    try {
      await this.kubernetes.coreV1.patchNode({
        name,
        // `add` replaces an existing member, so it works whether or not the
        // field is set. Cordoned nodes keep `true`; uncordon drops the field.
        body: schedulable
          ? [{ op: 'remove', path: '/spec/unschedulable' }]
          : [{ op: 'add', path: '/spec/unschedulable', value: true }],
      });
    } catch (error) {
      // Removing an unset field is a no-op for an already schedulable node.
      if (!(schedulable && getKubernetesStatusCode(error) === 422)) {
        throw this.toException(error, `update node ${name}`);
      }
    }

    return this.get(name);
  }

  async updateLabels(
    name: string,
    payload: UpdateNodeLabelsPayload,
  ): Promise<ClusterNode> {
    const labels = normalizeLabels(payload);

    try {
      const current = await this.kubernetes.coreV1.readNode({ name });
      const merged = { ...labels };

      // Labels owned by Kubernetes or k3s (role, hostname, arch, ...) are not
      // editable from the console and always survive an update.
      for (const [key, value] of Object.entries(
        current.metadata?.labels ?? {},
      )) {
        if (isReservedKey(key)) {
          merged[key] = value;
        }
      }

      await this.kubernetes.coreV1.patchNode({
        name,
        body: [{ op: 'add', path: '/metadata/labels', value: merged }],
      });
    } catch (error) {
      throw this.toException(error, `update node ${name}`);
    }

    return this.get(name);
  }

  async updateTaints(
    name: string,
    payload: UpdateNodeTaintsPayload,
  ): Promise<ClusterNode> {
    const taints = normalizeTaints(payload);

    try {
      const current = await this.kubernetes.coreV1.readNode({ name });
      const kept = (current.spec?.taints ?? []).filter((taint) =>
        isReservedKey(taint.key),
      );

      await this.kubernetes.coreV1.patchNode({
        name,
        body: [
          {
            op: 'add',
            path: '/spec/taints',
            value: [
              ...kept,
              ...taints.map((taint) => ({
                key: taint.key,
                effect: taint.effect,
                ...(taint.value ? { value: taint.value } : {}),
              })),
            ],
          },
        ],
      });
    } catch (error) {
      throw this.toException(error, `update node ${name}`);
    }

    return this.get(name);
  }

  private async countPods(nodeName: string): Promise<number> {
    const { items } = await this.kubernetes.coreV1.listPodForAllNamespaces({
      fieldSelector: `spec.nodeName=${nodeName}`,
    });

    return items.filter(isActivePod).length;
  }

  private async countPodsByNode(): Promise<Map<string, number>> {
    const { items } = await this.kubernetes.coreV1.listPodForAllNamespaces();
    const counts = new Map<string, number>();

    for (const pod of items) {
      const node = pod.spec?.nodeName;

      if (node && isActivePod(pod)) {
        counts.set(node, (counts.get(node) ?? 0) + 1);
      }
    }

    return counts;
  }

  private toException(error: unknown, action: string): Error {
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      return error;
    }

    if (getKubernetesStatusCode(error) === 404) {
      return new NotFoundException('Node not found');
    }

    this.logger.warn(`Failed to ${action}: ${(error as Error).message}`);

    return new ServiceUnavailableException('Kubernetes API is unavailable');
  }

  private toClusterNode(node: V1Node, podCount: number): ClusterNode {
    const labels = node.metadata?.labels ?? {};
    const readyCondition = node.status?.conditions?.find(
      (condition) => condition.type === 'Ready',
    );

    return {
      name: node.metadata?.name ?? '',
      status: this.toStatus(readyCondition?.status),
      roles: Object.keys(labels)
        .filter((label) => label.startsWith('node-role.kubernetes.io/'))
        .map((label) => label.slice('node-role.kubernetes.io/'.length))
        .filter(Boolean),
      version: node.status?.nodeInfo?.kubeletVersion ?? null,
      internal_ip:
        node.status?.addresses?.find((address) => address.type === 'InternalIP')
          ?.address ?? null,
      os: node.status?.nodeInfo?.osImage ?? null,
      container_runtime: node.status?.nodeInfo?.containerRuntimeVersion ?? null,
      cpu: node.status?.capacity?.cpu ?? null,
      memory: node.status?.capacity?.memory ?? null,
      storage: node.status?.capacity?.['ephemeral-storage'] ?? null,
      created_at: node.metadata?.creationTimestamp?.toISOString() ?? null,
      unschedulable: node.spec?.unschedulable === true,
      labels,
      taints: (node.spec?.taints ?? [])
        .filter((taint) =>
          (TAINT_EFFECTS as readonly string[]).includes(taint.effect),
        )
        .map((taint): ClusterNodeTaint => ({
          key: taint.key,
          value: taint.value ?? null,
          effect: taint.effect as ClusterNodeTaint['effect'],
        })),
      pod_count: podCount,
    };
  }

  private toStatus(status: string | undefined): ClusterNodeStatus {
    if (status === 'True') {
      return 'Ready';
    }

    if (status === 'False') {
      return 'NotReady';
    }

    return 'Unknown';
  }
}
