import { Injectable, Logger } from '@nestjs/common';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { INTERNAL_DNS_SUFFIX } from '@/common/naming';

/**
 * k3s's CoreDNS imports every `*.override` key of this ConfigMap into its
 * main server block, and reloads it on change. Other keys belong to the
 * operator and are never touched.
 */
export const COREDNS_CUSTOM_NAMESPACE = 'kube-system';
export const COREDNS_CUSTOM_NAME = 'coredns-custom';
export const INTERNAL_DNS_OVERRIDE_KEY = 'acceleratio-internal.override';

/** k3s's Corefile and the line that loads the override keys. */
export const COREDNS_NAME = 'coredns';
export const COREDNS_OVERRIDE_IMPORT = '/etc/coredns/custom/*.override';
/** How long a confirmed rule is trusted before it is checked again. */
export const DNS_RECHECK_MS = 5 * 60_000;

const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
const MANAGED_BY_VALUE = 'acceleratio';

export const clusterDomain = (): string =>
  process.env.CLUSTER_DOMAIN?.trim() || 'cluster.local';

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Makes `<hostname>.internal` resolve inside a project.
 *
 * A pod's resolv.conf searches `<namespace>.svc.<domain>` first and uses
 * `ndots:5`, so `postgres.internal` is asked as
 * `postgres.internal.project-<id>.svc.<domain>`. The rule rewrites that to
 * the Service `postgres.project-<id>.svc.<domain>` and the answer back. The
 * namespace comes from the asking pod's own search path, so a name never
 * resolves to a Service of another project.
 */
export const buildInternalDnsOverride = (domain = clusterDomain()): string => {
  const zone = `svc\\.${escapeRegex(domain)}`;
  const suffix = escapeRegex(INTERNAL_DNS_SUFFIX);

  return [
    '# Managed by Acceleratio: <service>.internal inside a project.',
    'rewrite stop {',
    `  name regex ^([a-z0-9]([-a-z0-9]*[a-z0-9])?)\\.${suffix}\\.(project-[-a-z0-9]+)\\.${zone}\\.$ {1}.{3}.svc.${domain}.`,
    '  answer auto',
    '}',
    '',
  ].join('\n');
};

/**
 * Owns the cluster-wide DNS rule behind private service names. `ensure` is
 * idempotent; after a success it is a no-op for `DNS_RECHECK_MS`, so a
 * ConfigMap deleted by hand comes back on a later deploy. A Corefile that
 * does not import the override (not k3s, or a customized one) is reported
 * once: the rule is written but cannot take effect there.
 */
@Injectable()
export class ProjectDnsService {
  private readonly logger = new Logger(ProjectDnsService.name);
  private ensuredAt: number | null = null;
  private corefileChecked = false;

  constructor(private readonly kubernetes: KubernetesService) {}

  async ensure(): Promise<void> {
    if (
      this.ensuredAt !== null &&
      Date.now() - this.ensuredAt < DNS_RECHECK_MS
    ) {
      return;
    }

    const value = buildInternalDnsOverride();
    let data: Record<string, string> | undefined;
    let exists = true;

    try {
      const existing = await this.kubernetes.coreV1.readNamespacedConfigMap({
        name: COREDNS_CUSTOM_NAME,
        namespace: COREDNS_CUSTOM_NAMESPACE,
      });
      data = existing.data;
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw toNestException(error);
      }

      exists = false;
    }

    try {
      if (!exists) {
        if (!(await this.create(value))) {
          // Created concurrently: the next call patches it if needed.
          return;
        }
      } else if (data?.[INTERNAL_DNS_OVERRIDE_KEY] !== value) {
        await this.kubernetes.coreV1.patchNamespacedConfigMap({
          name: COREDNS_CUSTOM_NAME,
          namespace: COREDNS_CUSTOM_NAMESPACE,
          body:
            data === undefined
              ? [
                  {
                    op: 'add',
                    path: '/data',
                    value: { [INTERNAL_DNS_OVERRIDE_KEY]: value },
                  },
                ]
              : [
                  {
                    op: 'add',
                    path: `/data/${INTERNAL_DNS_OVERRIDE_KEY}`,
                    value,
                  },
                ],
        });
        this.logger.log('Private service DNS rule written to CoreDNS');
      }
    } catch (error) {
      throw toNestException(error);
    }

    this.ensuredAt = Date.now();
    await this.checkCorefile();
  }

  /** Warns once when CoreDNS would never load the rule. */
  private async checkCorefile(): Promise<void> {
    if (this.corefileChecked) {
      return;
    }

    this.corefileChecked = true;
    let corefile: string | undefined;

    try {
      corefile = (
        await this.kubernetes.coreV1.readNamespacedConfigMap({
          name: COREDNS_NAME,
          namespace: COREDNS_CUSTOM_NAMESPACE,
        })
      ).data?.Corefile;
    } catch {
      corefile = undefined;
    }

    if (!corefile?.includes(COREDNS_OVERRIDE_IMPORT)) {
      this.logger.warn(
        `CoreDNS does not import ${COREDNS_OVERRIDE_IMPORT} from ${COREDNS_CUSTOM_NAMESPACE}/${COREDNS_CUSTOM_NAME}; <service>.internal names will not resolve. Add "import ${COREDNS_OVERRIDE_IMPORT}" to the main server block of the Corefile.`,
      );
    }
  }

  private async create(value: string): Promise<boolean> {
    try {
      await this.kubernetes.coreV1.createNamespacedConfigMap({
        namespace: COREDNS_CUSTOM_NAMESPACE,
        body: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: COREDNS_CUSTOM_NAME,
            namespace: COREDNS_CUSTOM_NAMESPACE,
            labels: { [MANAGED_BY_LABEL]: MANAGED_BY_VALUE },
          },
          data: { [INTERNAL_DNS_OVERRIDE_KEY]: value },
        },
      });
      this.logger.log('Private service DNS rule written to CoreDNS');

      return true;
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }

      return false;
    }
  }
}
