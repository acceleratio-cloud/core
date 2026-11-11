import { Injectable, Logger } from '@nestjs/common';
import type { V1Node, V1Pod } from '@kubernetes/client-node';
import type {
  SystemComponentState,
  SystemComponentStatus,
} from '@acceleratio/shared';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';

const env = (name: string, fallback: string): string =>
  process.env[name]?.trim() || fallback;

interface PodComponent {
  id: string;
  role: string;
  name: string;
  namespace: () => string;
  labelSelector?: string;
}

/** What the installer deploys; namespaces follow the installer's overrides. */
const COMPONENTS: PodComponent[] = [
  {
    id: 'network',
    role: 'Network',
    name: 'Cilium',
    namespace: () => 'kube-system',
    labelSelector: 'app.kubernetes.io/part-of=cilium',
  },
  {
    id: 'dns',
    role: 'DNS',
    name: 'CoreDNS',
    namespace: () => 'kube-system',
    labelSelector: 'k8s-app=kube-dns',
  },
  {
    id: 'ingress',
    role: 'Ingress',
    name: 'Traefik',
    namespace: () => env('TRAEFIK_NAMESPACE', 'kube-system'),
    labelSelector: 'app.kubernetes.io/name=traefik',
  },
  {
    id: 'storage',
    role: 'Storage',
    name: 'SeaweedFS',
    namespace: () => env('SEAWEEDFS_NAMESPACE', 'seaweedfs'),
  },
  {
    id: 'databases',
    role: 'Databases',
    name: 'CloudNativePG',
    namespace: () => env('CNPG_NAMESPACE', 'cnpg-system'),
  },
  {
    id: 'metrics',
    role: 'Metrics',
    name: 'VictoriaMetrics',
    namespace: () => env('VICTORIAMETRICS_NAMESPACE', 'victoria-metrics'),
  },
  {
    id: 'logs',
    role: 'Logs',
    name: 'VictoriaLogs',
    namespace: () => env('VICTORIALOGS_NAMESPACE', 'victoria-logs'),
  },
  {
    id: 'control-plane',
    role: 'Control plane',
    name: 'Acceleratio',
    namespace: () => env('ACCELERATIO_NAMESPACE', 'acceleratio'),
  },
];

const hasTrueCondition = (
  conditions: { type: string; status: string }[] | undefined,
  type: string,
): boolean =>
  conditions?.some(
    (condition) => condition.type === type && condition.status === 'True',
  ) ?? false;

/** Pods that are meant to keep running: finished ones and Job pods are not. */
const isLongRunning = (pod: V1Pod): boolean =>
  pod.status?.phase !== 'Succeeded' &&
  !pod.metadata?.ownerReferences?.some((owner) => owner.kind === 'Job');

export const stateOf = (ready: number, total: number): SystemComponentState =>
  total === 0 || ready === 0
    ? 'down'
    : ready < total
      ? 'degraded'
      : 'operational';

export const countPods = (pods: V1Pod[]) => {
  const running = pods.filter(isLongRunning);
  return {
    ready: running.filter((pod) =>
      hasTrueCondition(pod.status?.conditions, 'Ready'),
    ).length,
    total: running.length,
  };
};

export const countNodes = (nodes: V1Node[]) => ({
  ready: nodes.filter((node) =>
    hasTrueCondition(node.status?.conditions, 'Ready'),
  ).length,
  total: nodes.length,
});

/** Reports whether each platform component has all its pods ready. */
@Injectable()
export class SystemStatusService {
  private readonly logger = new Logger(SystemStatusService.name);

  constructor(private readonly kubernetes: KubernetesService) {}

  status(): Promise<SystemComponentStatus[]> {
    return Promise.all([
      this.check(
        { id: 'cluster', role: 'Cluster', name: 'Kubernetes' },
        async () => countNodes((await this.kubernetes.coreV1.listNode()).items),
      ),
      ...COMPONENTS.map(({ namespace, labelSelector, ...component }) =>
        this.check(component, async () =>
          countPods(
            (
              await this.kubernetes.coreV1.listNamespacedPod({
                namespace: namespace(),
                labelSelector,
              })
            ).items,
          ),
        ),
      ),
    ]);
  }

  private async check(
    component: Pick<SystemComponentStatus, 'id' | 'role' | 'name'>,
    count: () => Promise<{ ready: number; total: number }>,
  ): Promise<SystemComponentStatus> {
    try {
      const { ready, total } = await count();
      return { ...component, state: stateOf(ready, total), ready, total };
    } catch (error) {
      this.logger.warn(
        `Could not read the status of ${component.name}: ${String(error)}`,
      );
      return { ...component, state: 'unknown', ready: 0, total: 0 };
    }
  }
}
