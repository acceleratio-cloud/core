import { existsSync, readFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import type { V1Pod } from '@kubernetes/client-node';
import type { PlatformComponent } from '@acceleratio/shared';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  decodeHelmRelease,
  type HelmReleaseInfo,
} from './platform-version.helm';
import { imageTag, normalizeVersion } from './platform-version.semver';
import { rustfsNamespace } from '@/vendor/s3/rustfs';

const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
const DEFAULT_NAMESPACE = 'acceleratio';
/** Components are read from the cluster at most this often. */
const CACHE_MS = 30 * 1000;
const POSTGRES_POD = 'postgres-0';

const readNamespace = (): string => {
  const configured = process.env.ACCELERATIO_NAMESPACE?.trim();

  if (configured) {
    return configured;
  }

  try {
    return readFileSync(`${SERVICE_ACCOUNT_DIR}/namespace`, 'utf8').trim();
  } catch {
    return DEFAULT_NAMESPACE;
  }
};

const HELM_NAMES: Record<string, string> = {
  cilium: 'Cilium',
  longhorn: 'Longhorn',
  'victoria-metrics-single': 'VictoriaMetrics',
};

/**
 * Reads what the installation runs: the API's own version, the console and
 * PostgreSQL images, Kubernetes on the server and every deployed Helm chart.
 */
@Injectable()
export class PlatformVersionService {
  private readonly logger = new Logger(PlatformVersionService.name);
  readonly namespace = readNamespace();
  private cache: { at: number; components: PlatformComponent[] } | null = null;
  private apiImage: string | null | undefined;

  constructor(private readonly kubernetes: KubernetesService) {}

  /** True when the API runs as a Pod of the cluster it manages. */
  get inCluster(): boolean {
    return existsSync(`${SERVICE_ACCOUNT_DIR}/token`);
  }

  /**
   * The release the API belongs to: ACCELERATIO_VERSION baked into the image,
   * otherwise the tag of the API Deployment's image. Null for a development
   * build.
   */
  async currentVersion(): Promise<string | null> {
    const baked = normalizeVersion(process.env.ACCELERATIO_VERSION);

    if (baked) {
      return baked;
    }

    return normalizeVersion(imageTag(await this.readApiImage()));
  }

  /** The image of the API Deployment, used for the update launcher too. */
  async readApiImage(): Promise<string | null> {
    if (this.apiImage !== undefined) {
      return this.apiImage;
    }

    const image = await this.deploymentImage('deployment', 'api');

    // Cache a hit only; a failed read is retried next time.
    if (image) {
      this.apiImage = image;
    }

    return image;
  }

  /** The node that holds the installation: where PostgreSQL keeps its data. */
  async installationNode(): Promise<string | null> {
    try {
      const pod: V1Pod = await this.kubernetes.coreV1.readNamespacedPod({
        name: POSTGRES_POD,
        namespace: this.namespace,
      });
      return pod.spec?.nodeName ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed to find the installation node: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async components(): Promise<PlatformComponent[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.components;
    }

    const [
      version,
      apiImage,
      consoleImage,
      postgresImage,
      rustfsImage,
      kubernetes,
      helm,
    ] = await Promise.all([
      this.currentVersion(),
      this.readApiImage(),
      this.deploymentImage('deployment', 'console'),
      this.deploymentImage('statefulset', 'postgres'),
      this.deploymentImage('deployment', 'rustfs', rustfsNamespace()),
      this.kubernetesVersion(),
      this.helmReleases(),
    ]);

    const components: PlatformComponent[] = [
      {
        id: 'api',
        name: 'API',
        version: version ?? imageTag(apiImage),
        detail: apiImage,
      },
      {
        id: 'console',
        name: 'Console',
        version:
          normalizeVersion(imageTag(consoleImage)) ?? imageTag(consoleImage),
        detail: consoleImage,
      },
      {
        id: 'kubernetes',
        name: 'Kubernetes',
        version: kubernetes,
        detail: kubernetes?.includes('k3s') ? 'k3s' : null,
      },
      ...helm.map((release) => ({
        id: `helm:${release.namespace}/${release.name}`,
        name: (release.chart && HELM_NAMES[release.chart]) ?? release.name,
        version: release.version,
        detail:
          [
            release.chart ? `chart ${release.chart}` : null,
            release.appVersion ? `app ${release.appVersion}` : null,
          ]
            .filter(Boolean)
            .join(', ') || null,
      })),
      {
        id: 'postgres',
        name: 'PostgreSQL',
        version: imageTag(postgresImage),
        detail: postgresImage,
      },
      ...(rustfsImage
        ? [
            {
              id: 'rustfs',
              name: 'RustFS',
              version: imageTag(rustfsImage),
              detail: rustfsImage,
            },
          ]
        : []),
    ];

    this.cache = { at: Date.now(), components };
    return components;
  }

  /** Drops the cached components, for example after an update. */
  invalidate(): void {
    this.cache = null;
    this.apiImage = undefined;
  }

  private async deploymentImage(
    kind: 'deployment' | 'statefulset',
    name: string,
    namespace = this.namespace,
  ): Promise<string | null> {
    try {
      const resource =
        kind === 'deployment'
          ? await this.kubernetes.appsV1.readNamespacedDeployment({
              name,
              namespace,
            })
          : await this.kubernetes.appsV1.readNamespacedStatefulSet({
              name,
              namespace,
            });
      const containers = resource.spec?.template.spec?.containers ?? [];
      return (
        containers.find((container) => container.name === name)?.image ??
        containers[0]?.image ??
        null
      );
    } catch {
      return null;
    }
  }

  private async kubernetesVersion(): Promise<string | null> {
    try {
      const nodeName = await this.installationNode();
      const nodes = await this.kubernetes.coreV1.listNode();
      const node =
        nodes.items.find((item) => item.metadata?.name === nodeName) ??
        nodes.items[0];
      return node?.status?.nodeInfo?.kubeletVersion ?? null;
    } catch {
      return null;
    }
  }

  private async helmReleases(): Promise<HelmReleaseInfo[]> {
    try {
      const secrets = await this.kubernetes.coreV1.listSecretForAllNamespaces({
        labelSelector: 'owner=helm,status=deployed',
      });

      return secrets.items
        .map(decodeHelmRelease)
        .filter((release): release is HelmReleaseInfo => release !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      this.logger.warn(
        `Failed to read Helm releases: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
