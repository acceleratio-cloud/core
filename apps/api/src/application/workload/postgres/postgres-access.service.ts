import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { V1Secret, V1Service } from '@kubernetes/client-node';
import type {
  PostgresCredentials,
  PostgresExposure,
  UpdatePostgresExposurePayload,
} from '@acceleratio/shared';
import {
  CILIUM_GROUP,
  CILIUM_POLICY_PLURAL,
  CILIUM_VERSION,
} from '@/application/project/cilium';
import { projectNamespace } from '@/common/naming';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadRow } from '../schemas/workload.schema';
import { normalizeAllowedCidrs, normalizeNodePort } from './postgres.config';
import {
  ALLOWED_CIDRS_ANNOTATION,
  buildClusterPolicy,
  buildExternalService,
  clusterPolicyName,
  CNPG_CLUSTER_LABEL,
  CNPG_CLUSTER_PLURAL,
  CNPG_GROUP,
  CNPG_ROLE_LABEL,
  CNPG_VERSION,
  type CnpgCluster,
  credentialsSecretName,
  externalServiceName,
  POSTGRES_USERNAME,
  tlsOutsidePodNetwork,
} from './postgres.manifests';
import { PostgresWorkloadService } from './postgres.service';

const PORT_TAKEN_MESSAGE = 'That node port is already used by another service';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A password of 32 URL-safe characters (192 bits). */
export const generatePassword = (): string =>
  randomBytes(24).toString('base64url');

/**
 * External access and credentials of a PostgreSQL workload. The cluster is
 * the only record: the external Service exists exactly while the port is
 * open and carries its allowed networks.
 */
@Injectable()
export class PostgresAccessService {
  private readonly logger = new Logger(PostgresAccessService.name);

  constructor(
    private readonly databases: PostgresWorkloadService,
    private readonly kubernetes: KubernetesService,
  ) {}

  private get podCidr(): string | undefined {
    return process.env.K3S_CLUSTER_CIDR?.trim() || undefined;
  }

  private get operatorNamespace(): string | undefined {
    return process.env.CNPG_NAMESPACE?.trim() || undefined;
  }

  async exposure(projectId: string, id: string): Promise<PostgresExposure> {
    const row = await this.databases.findDatabase(projectId, id);

    return this.present(row, await this.readService(row));
  }

  /**
   * Opens, changes or closes the port. Opening also makes sure the server
   * takes only TLS from outside, for databases created before that rule.
   */
  async updateExposure(
    projectId: string,
    id: string,
    payload: UpdatePostgresExposurePayload,
  ): Promise<PostgresExposure> {
    const row = await this.databases.findDatabase(projectId, id);
    const enabled = payload?.enabled === true;
    const cidrs = enabled ? normalizeAllowedCidrs(payload.allowed_cidrs) : [];
    const nodePort = enabled ? normalizeNodePort(payload.node_port) : null;

    try {
      if (enabled) {
        const before = this.allowedOf(await this.readService(row));

        await this.ensureTlsRule(row);
        // The policy first, so the port never opens wider than asked.
        await this.applyPolicy(row, cidrs);

        try {
          await this.applyService(row, cidrs, nodePort);
        } catch (error) {
          // A port that did not open (or change) keeps its old networks.
          await this.applyPolicy(row, before).catch((restoreError) =>
            this.logger.warn(
              `Could not restore the policy of database ${row.external_name}: ${describeError(restoreError)}`,
            ),
          );

          throw error;
        }
      } else {
        await this.ignoreNotFound(() =>
          this.kubernetes.coreV1.deleteNamespacedService({
            name: externalServiceName(row.external_name),
            namespace: projectNamespace(row.project_id),
          }),
        );
        await this.applyPolicy(row, []);
      }
    } catch (error) {
      throw this.mapClusterError(error);
    }

    return this.present(row, await this.readService(row));
  }

  /** The current password, read from its Secret only when asked for. */
  async credentials(
    projectId: string,
    id: string,
  ): Promise<PostgresCredentials> {
    const row = await this.databases.findDatabase(projectId, id);
    const name = credentialsSecretName(row.external_name);
    let secret: V1Secret;

    try {
      secret = await this.kubernetes.coreV1.readNamespacedSecret({
        name,
        namespace: projectNamespace(row.project_id),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        throw new NotFoundException('The database password is missing');
      }

      throw this.mapClusterError(error);
    }

    const decode = (key: string) =>
      Buffer.from(secret.data?.[key] ?? '', 'base64').toString('utf8');

    return {
      username: decode('username') || POSTGRES_USERNAME,
      password: decode('password'),
      secret_name: name,
    };
  }

  /**
   * Writes a new password to the credentials Secret; CNPG sets it on the
   * role within seconds. Returned this once only.
   */
  async rotateCredentials(
    projectId: string,
    id: string,
  ): Promise<PostgresCredentials> {
    const row = await this.databases.findDatabase(projectId, id);
    const password = generatePassword();
    const name = credentialsSecretName(row.external_name);

    try {
      await this.kubernetes.coreV1.patchNamespacedSecret({
        name,
        namespace: projectNamespace(row.project_id),
        body: [
          {
            op: 'replace',
            path: '/data/password',
            value: Buffer.from(password).toString('base64'),
          },
        ],
      });
    } catch (error) {
      throw this.mapClusterError(error);
    }

    this.logger.log(`Password of database ${row.external_name} was replaced`);

    return { username: POSTGRES_USERNAME, password, secret_name: name };
  }

  private async ensureTlsRule(row: WorkloadRow): Promise<void> {
    const cluster =
      (await this.kubernetes.customObjects.getNamespacedCustomObject({
        group: CNPG_GROUP,
        version: CNPG_VERSION,
        namespace: projectNamespace(row.project_id),
        plural: CNPG_CLUSTER_PLURAL,
        name: row.external_name,
      })) as CnpgCluster;
    const rules = tlsOutsidePodNetwork(this.podCidr);
    const postgresql = cluster.spec.postgresql as
      { pg_hba?: string[] } | undefined;

    if (JSON.stringify(postgresql?.pg_hba) === JSON.stringify(rules)) {
      return;
    }

    await this.kubernetes.customObjects.patchNamespacedCustomObject({
      group: CNPG_GROUP,
      version: CNPG_VERSION,
      namespace: projectNamespace(row.project_id),
      plural: CNPG_CLUSTER_PLURAL,
      name: row.external_name,
      body: [
        postgresql === undefined
          ? { op: 'add', path: '/spec/postgresql', value: { pg_hba: rules } }
          : { op: 'add', path: '/spec/postgresql/pg_hba', value: rules },
      ],
    });
  }

  private async applyPolicy(row: WorkloadRow, cidrs: string[]): Promise<void> {
    const target = {
      group: CILIUM_GROUP,
      version: CILIUM_VERSION,
      namespace: projectNamespace(row.project_id),
      plural: CILIUM_POLICY_PLURAL,
    };
    const body = buildClusterPolicy(row, this.operatorNamespace, cidrs);
    let resourceVersion: string | undefined;

    try {
      const current =
        (await this.kubernetes.customObjects.getNamespacedCustomObject({
          ...target,
          name: clusterPolicyName(row.external_name),
        })) as { metadata?: { resourceVersion?: string } };

      resourceVersion = current.metadata?.resourceVersion;
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }

      await this.kubernetes.customObjects.createNamespacedCustomObject({
        ...target,
        body,
      });

      return;
    }

    await this.kubernetes.customObjects.replaceNamespacedCustomObject({
      ...target,
      name: clusterPolicyName(row.external_name),
      body: { ...body, metadata: { ...body.metadata, resourceVersion } },
    });
  }

  private async applyService(
    row: WorkloadRow,
    cidrs: string[],
    nodePort: number | null,
  ): Promise<void> {
    const body = buildExternalService(row, cidrs, nodePort);
    const current = await this.readService(row);

    if (current === null) {
      await this.kubernetes.coreV1.createNamespacedService({
        namespace: projectNamespace(row.project_id),
        body,
      });

      return;
    }

    // A JSON Patch keeps the allocated cluster IP and, unless a port is
    // asked for, the node port.
    const currentPort = current.spec?.ports?.[0]?.nodePort ?? null;

    await this.kubernetes.coreV1.patchNamespacedService({
      name: externalServiceName(row.external_name),
      namespace: projectNamespace(row.project_id),
      body: [
        {
          op: 'replace',
          path: '/metadata/annotations',
          value: body.metadata?.annotations,
        },
        ...(nodePort !== null && nodePort !== currentPort
          ? [{ op: 'replace', path: '/spec/ports/0/nodePort', value: nodePort }]
          : []),
      ],
    });
  }

  private async readService(row: WorkloadRow): Promise<V1Service | null> {
    try {
      return await this.kubernetes.coreV1.readNamespacedService({
        name: externalServiceName(row.external_name),
        namespace: projectNamespace(row.project_id),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return null;
      }

      throw this.mapClusterError(error);
    }
  }

  /** The address of the node that runs the primary: the one that answers. */
  private async primaryNodeHost(row: WorkloadRow): Promise<string | null> {
    try {
      const { items } = await this.kubernetes.coreV1.listNamespacedPod({
        namespace: projectNamespace(row.project_id),
        labelSelector: `${CNPG_CLUSTER_LABEL}=${row.external_name},${CNPG_ROLE_LABEL}=primary`,
      });
      const nodeName = items.find((pod) => pod.status?.phase === 'Running')
        ?.spec?.nodeName;

      if (!nodeName) {
        return null;
      }

      const node = await this.kubernetes.coreV1.readNode({ name: nodeName });
      const addresses = node.status?.addresses ?? [];

      return (
        addresses.find((address) => address.type === 'ExternalIP')?.address ??
        addresses.find((address) => address.type === 'InternalIP')?.address ??
        null
      );
    } catch (error) {
      this.logger.warn(
        `Could not find the node of database ${row.external_name}: ${describeError(error)}`,
      );

      return null;
    }
  }

  private async present(
    row: WorkloadRow,
    service: V1Service | null,
  ): Promise<PostgresExposure> {
    if (service === null) {
      return { enabled: false, allowed_cidrs: [], node_port: null, host: null };
    }

    return {
      enabled: true,
      allowed_cidrs: this.allowedOf(service),
      node_port: service.spec?.ports?.[0]?.nodePort ?? null,
      host: await this.primaryNodeHost(row),
    };
  }

  private allowedOf(service: V1Service | null): string[] {
    return (service?.metadata?.annotations?.[ALLOWED_CIDRS_ANNOTATION] ?? '')
      .split(',')
      .filter(Boolean);
  }

  private async ignoreNotFound(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }
    }
  }

  private mapClusterError(error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    // Kubernetes answers 422 "provided port is already allocated".
    if (
      getKubernetesStatusCode(error) === 422 &&
      /already allocated/i.test(describeError(error))
    ) {
      return new ConflictException(PORT_TAKEN_MESSAGE);
    }

    this.logger.warn(`Kubernetes request failed: ${describeError(error)}`);

    return toNestException(error);
  }
}
