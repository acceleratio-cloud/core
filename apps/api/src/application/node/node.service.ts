import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { V1Node } from '@kubernetes/client-node';
import type { ClusterNode, ClusterNodeStatus } from '@acceleratio/shared';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';

@Injectable()
export class NodeService {
  private readonly logger = new Logger(NodeService.name);

  constructor(private readonly kubernetes: KubernetesService) {}

  async list(): Promise<ClusterNode[]> {
    try {
      const { items } = await this.kubernetes.coreV1.listNode();

      return items.map((node) => this.toClusterNode(node));
    } catch (error) {
      this.logger.warn(
        `Failed to list cluster nodes: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Kubernetes API is unavailable');
    }
  }

  private toClusterNode(node: V1Node): ClusterNode {
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
