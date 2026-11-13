import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { V1Namespace } from '@kubernetes/client-node';
import { projectNamespace } from '@/common/naming';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { rustfsNamespace } from '@/vendor/s3/rustfs';
import {
  CILIUM_GROUP,
  CILIUM_POLICY_PLURAL,
  CILIUM_VERSION,
  NAMESPACE_LABEL,
} from './cilium';
import { ProjectDnsService } from './project-dns.service';

export const ISOLATION_POLICY_NAME = 'acceleratio-project-isolation';

const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
const MANAGED_BY_VALUE = 'acceleratio';
const PROJECT_ID_LABEL = 'acceleratio.io/project-id';
const CILIUM_CRD_NAME = `${CILIUM_POLICY_PLURAL}.${CILIUM_GROUP}`;
const CRD_GROUP = 'apiextensions.k8s.io';
const CRD_VERSION = 'v1';
const CRD_PLURAL = 'customresourcedefinitions';
const KUBE_DNS_NAMESPACE = 'kube-system';
const KUBE_DNS_LABEL = 'k8s-app';
const KUBE_DNS_VALUE = 'kube-dns';
const DNS_PORTS = [
  { port: '53', protocol: 'UDP' },
  { port: '53', protocol: 'TCP' },
];
// RustFS serves S3 on one port. Only that port is opened, and every request
// still needs a bucket's (or a static site's) own keys.
const S3_PORTS = [{ port: '9000', protocol: 'TCP' }];
// k3s's bundled Traefik forwards the domains of Docker services to their pods.
const traefikNamespace = (): string =>
  process.env.TRAEFIK_NAMESPACE?.trim() || 'kube-system';
const TRAEFIK_POD_LABEL = 'app.kubernetes.io/name';
const TRAEFIK_POD_VALUE = 'traefik';
const CRD_MISSING_MESSAGE =
  'CiliumNetworkPolicy CRD is not installed; project isolation cannot be enforced';

interface CiliumNetworkPolicy {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    resourceVersion?: string;
  };
  spec: {
    endpointSelector: { matchLabels: Record<string, string> };
    enableDefaultDeny: { ingress: boolean; egress: boolean };
    ingress: Array<Record<string, unknown>>;
    egress: Array<Record<string, unknown>>;
  };
}

interface PolicyMetadata {
  metadata?: { resourceVersion?: string };
}

/**
 * Owns the per-project Kubernetes boundary: a namespace and the
 * CiliumNetworkPolicy that keeps project pods away from other namespaces while
 * allowing DNS, kubelet probes, Traefik (for service domains) and outbound
 * internet access. Every pod of the project reaches every other one on any
 * port: that is the project's private network. `world` covers only addresses
 * outside the cluster, so pods of other projects stay unreachable both ways.
 *
 * `ensure` is idempotent and updates an existing policy, so rule changes apply
 * on the next deploy. Missing Cilium CRD is a hard failure: silently skipping
 * the policy would leave projects unisolated.
 */
@Injectable()
export class ProjectIsolationService {
  private readonly logger = new Logger(ProjectIsolationService.name);

  constructor(
    private readonly kubernetes: KubernetesService,
    private readonly dns: ProjectDnsService,
  ) {}

  async ensure(projectId: string): Promise<void> {
    const namespace = projectNamespace(projectId);

    await this.ensureCrd();
    await this.ensureNamespace(namespace, projectId);
    await this.ensurePolicy(namespace);
    // Private service names (`<service>.internal`) rely on one cluster-wide
    // CoreDNS rule; the policy above is what keeps them inside the project.
    await this.dns.ensure();
  }

  async remove(projectId: string): Promise<void> {
    const name = projectNamespace(projectId);
    let namespace: V1Namespace;

    try {
      namespace = await this.kubernetes.coreV1.readNamespace({ name });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return;
      }

      throw toNestException(error);
    }

    // A Terminating namespace cannot be deleted again and its resources are
    // already being collected; blocking project deletion on it is worse than
    // accepting that it is on its way out.
    if (namespace.metadata?.deletionTimestamp !== undefined) {
      return;
    }

    try {
      await this.kubernetes.coreV1.deleteNamespace({ name });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return;
      }

      throw toNestException(error);
    }
  }

  private async ensureCrd(): Promise<void> {
    try {
      await this.kubernetes.customObjects.getClusterCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        plural: CRD_PLURAL,
        name: CILIUM_CRD_NAME,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        throw new ServiceUnavailableException(CRD_MISSING_MESSAGE);
      }

      throw toNestException(error);
    }
  }

  private async ensureNamespace(
    namespace: string,
    projectId: string,
  ): Promise<void> {
    try {
      await this.kubernetes.coreV1.readNamespace({ name: namespace });

      return;
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw toNestException(error);
      }
    }

    try {
      await this.kubernetes.coreV1.createNamespace({
        body: {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: namespace,
            labels: {
              [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
              [PROJECT_ID_LABEL]: projectId,
            },
          },
        },
      });
    } catch (error) {
      // A concurrent create means the namespace already exists, which is the
      // desired state.
      if (getKubernetesStatusCode(error) !== 409) {
        throw toNestException(error);
      }
    }
  }

  private async ensurePolicy(namespace: string): Promise<void> {
    let resourceVersion: string | undefined;
    let exists = false;

    try {
      const existing =
        (await this.kubernetes.customObjects.getNamespacedCustomObject({
          group: CILIUM_GROUP,
          version: CILIUM_VERSION,
          namespace,
          plural: CILIUM_POLICY_PLURAL,
          name: ISOLATION_POLICY_NAME,
        })) as PolicyMetadata;

      resourceVersion = existing.metadata?.resourceVersion;
      exists = true;
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw toNestException(error);
      }
    }

    if (exists) {
      await this.replacePolicy(namespace, resourceVersion);

      return;
    }

    try {
      await this.kubernetes.customObjects.createNamespacedCustomObject({
        group: CILIUM_GROUP,
        version: CILIUM_VERSION,
        namespace,
        plural: CILIUM_POLICY_PLURAL,
        body: this.buildPolicy(namespace),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw toNestException(error);
      }

      this.logger.warn(
        `Isolation policy appeared concurrently in namespace ${namespace}`,
      );
    }
  }

  private async replacePolicy(
    namespace: string,
    resourceVersion: string | undefined,
  ): Promise<void> {
    const body = this.buildPolicy(namespace);

    if (resourceVersion !== undefined) {
      body.metadata.resourceVersion = resourceVersion;
    }

    try {
      await this.replacePolicyBody(namespace, body);
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw toNestException(error);
      }

      // One retry on a concurrent update, using the resourceVersion the
      // cluster reports now.
      const current =
        (await this.kubernetes.customObjects.getNamespacedCustomObject({
          group: CILIUM_GROUP,
          version: CILIUM_VERSION,
          namespace,
          plural: CILIUM_POLICY_PLURAL,
          name: ISOLATION_POLICY_NAME,
        })) as PolicyMetadata;
      const currentVersion = current.metadata?.resourceVersion;

      if (currentVersion === undefined) {
        throw toNestException(error);
      }

      const retryBody = this.buildPolicy(namespace);
      retryBody.metadata.resourceVersion = currentVersion;

      try {
        await this.replacePolicyBody(namespace, retryBody);
      } catch (retryError) {
        throw toNestException(retryError);
      }
    }
  }

  private async replacePolicyBody(
    namespace: string,
    body: CiliumNetworkPolicy,
  ): Promise<void> {
    await this.kubernetes.customObjects.replaceNamespacedCustomObject({
      group: CILIUM_GROUP,
      version: CILIUM_VERSION,
      namespace,
      plural: CILIUM_POLICY_PLURAL,
      name: ISOLATION_POLICY_NAME,
      body,
    });
  }

  private buildPolicy(namespace: string): CiliumNetworkPolicy {
    const namespaceSelector = { [NAMESPACE_LABEL]: namespace };

    return {
      apiVersion: `${CILIUM_GROUP}/${CILIUM_VERSION}`,
      kind: 'CiliumNetworkPolicy',
      metadata: { name: ISOLATION_POLICY_NAME, namespace },
      spec: {
        endpointSelector: { matchLabels: {} },
        enableDefaultDeny: { ingress: true, egress: true },
        ingress: [
          { fromEndpoints: [{ matchLabels: namespaceSelector }] },
          { fromEntities: ['host', 'remote-node'] },
          {
            fromEndpoints: [
              {
                matchLabels: {
                  [NAMESPACE_LABEL]: traefikNamespace(),
                  [TRAEFIK_POD_LABEL]: TRAEFIK_POD_VALUE,
                },
              },
            ],
          },
        ],
        egress: [
          { toEndpoints: [{ matchLabels: namespaceSelector }] },
          {
            toEndpoints: [
              {
                matchLabels: {
                  [NAMESPACE_LABEL]: KUBE_DNS_NAMESPACE,
                  [KUBE_DNS_LABEL]: KUBE_DNS_VALUE,
                },
              },
            ],
            toPorts: [{ ports: DNS_PORTS }],
          },
          {
            toEndpoints: [
              {
                matchLabels: {
                  [NAMESPACE_LABEL]: rustfsNamespace(),
                  // The pod label of scripts/install.sh's RustFS Deployment.
                  'app.kubernetes.io/name': 'rustfs',
                },
              },
            ],
            toPorts: [{ ports: S3_PORTS }],
          },
          { toEntities: ['world'] },
        ],
      },
    };
  }
}
