import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { V1Service } from '@kubernetes/client-node';
import type {
  AddWorkloadDomainPayload,
  DnsCheck,
  GenerateWorkloadDomainPayload,
  UpdateInternalHostnamePayload,
  UpdateWorkloadDomainPayload,
  WorkloadDomain,
  WorkloadDomainCertificate,
  WorkloadDomains,
} from '@acceleratio/shared';
import { isContainerWorkload } from '@acceleratio/shared';
import { and, asc, count, eq, type SQL } from 'drizzle-orm';
import { ProjectDnsService } from '@/application/project/project-dns.service';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ControlPlaneDnsService } from '@/application/system/control-plane-dns.service';
import { systemSetting } from '@/application/system/schemas/system-setting.schema';
import {
  workloadDomain,
  type WorkloadDomainRow,
} from '@/application/workload/schemas/workload-domain.schema';
import {
  workload,
  type WorkloadRow,
} from '@/application/workload/schemas/workload.schema';
import { projectNamespace } from '@/common/naming';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { TraefikClient } from '@/vendor/traefik/traefik.client';
import {
  buildDomainRoutes,
  buildHttpsRedirectMiddleware,
  buildInternalService,
  buildNetworkService,
  domainHttpRouteName,
  domainRouteName,
  INTERNAL_SERVICE_ROLE,
  SERVICE_ROLE_LABEL,
  servicePorts,
  type NetworkWorkloadInput,
} from './docker-workload-network.manifests';
import {
  INTERNAL_HOSTNAME_CONSTRAINT,
  INTERNAL_HOSTNAME_TAKEN_MESSAGE,
  normalizeInternalHostname,
  pickInternalHostname,
} from './docker-workload-network.internal';
import { WORKLOAD_ID_LABEL } from './docker-workload.manifests';
import {
  AWAITING_RECORD_MESSAGE,
  CERTIFICATE_TIMEOUT_MESSAGE,
  CUSTOM_DOMAINS_MAX,
  describeDnsCheck,
  GENERATED_CERTIFICATE_TIMEOUT_MESSAGE,
  GENERATED_ISSUING_MESSAGE,
  generatedHostname,
  generatedSuffix,
  normalizeCustomHostname,
  normalizePort,
  suggestedLabel,
} from './docker-workload-network.domains';

/** How long a verified custom domain may wait for its certificate. */
export const CERTIFICATE_TIMEOUT_MS = 10 * 60 * 1000;
/** How often pending custom domains are checked in the background. */
export const VERIFY_INTERVAL_MS = 15 * 1000;

const UNIQUE_VIOLATION = '23505';
const GENERATED_UNIQUE_CONSTRAINT = 'workload_domain_generated_unique';

export const NOT_DOCKER_MESSAGE = 'Only Docker services have domains';
export const DOMAIN_NOT_FOUND_MESSAGE = 'Domain not found';
export const GENERATED_EXISTS_MESSAGE =
  'This service already has a generated domain';
export const HOSTNAME_TAKEN_MESSAGE =
  'This domain is already used by another service';
export const CONTROL_PLANE_HOSTNAME_MESSAGE =
  'This domain is the console URL and cannot be assigned to a service';
export const CUSTOM_LIMIT_MESSAGE = `A service can have at most ${CUSTOM_DOMAINS_MAX} custom domains`;
export const PUBLIC_IP_UNKNOWN_MESSAGE =
  'The server public IP is unknown, so a domain cannot be generated. Set ACCELERATIO_PUBLIC_IP on the API.';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Unique violation and its constraint, from the error or one of its causes. */
const uniqueViolation = (error: unknown): string | null => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (
    typeof current === 'object' &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };

    if (candidate.code === UNIQUE_VIOLATION) {
      return typeof candidate.constraint === 'string'
        ? candidate.constraint
        : '';
    }

    current = candidate.cause;
  }

  return null;
};

/** Not routed means no certificate can be requested yet, unless it failed. */
const toCertificate = (row: WorkloadDomainRow): WorkloadDomainCertificate => {
  if (row.certificate_status === 'failed') {
    return 'failed';
  }

  if (!row.routed) {
    return 'waiting';
  }

  return row.certificate_status === 'issued' ? 'issued' : 'issuing';
};

/** A private-network Service that this workload wrote. */
const isOwnInternalService = (service: V1Service, workloadId: string) => {
  const labels = service.metadata?.labels ?? {};

  return (
    labels[WORKLOAD_ID_LABEL] === workloadId &&
    labels[SERVICE_ROLE_LABEL] === INTERNAL_SERVICE_ROLE
  );
};

const toNetworkInput = (row: WorkloadRow): NetworkWorkloadInput => ({
  id: row.id,
  project_id: row.project_id,
  external_name: row.external_name,
});

/**
 * Domains and the private network name of Docker services.
 *
 * Every Docker service has a headless Service named by its private hostname,
 * so `<hostname>.internal` reaches it on any port from the same project. It
 * is written on every deploy, kept while the service has no domain, and
 * renamed immediately when the hostname changes. It never shares a name with
 * the domain Service (`external_name`).
 *
 * A domain is not part of the versioned config:
 * every change writes Traefik routes and the service's Kubernetes Service at
 * once and never touches the Deployment, so pods do not roll.
 *
 * A generated domain (`<label>-<ip>.sslip.io`) resolves to the server by
 * itself and is routed on creation. A custom domain is routed only once its A
 * record points to the server; until then nothing is written to the cluster.
 * Pending custom domains are re-checked in the background, so they go live
 * without the console being open.
 */
@Injectable()
export class DockerWorkloadNetworkService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DockerWorkloadNetworkService.name);
  private timer: NodeJS.Timeout | null = null;
  private verifying = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kubernetes: KubernetesService,
    private readonly traefik: TraefikClient,
    private readonly dns: ControlPlaneDnsService,
    private readonly isolation: ProjectIsolationService,
    private readonly projectDns: ProjectDnsService,
  ) {}

  /** The cluster-wide DNS rule behind `<hostname>.internal`. */
  ensureDnsRule(): Promise<void> {
    return this.projectDns.ensure();
  }

  /**
   * Gives a Docker row without a private hostname the first free one
   * (`postgres`, `postgres-2`, ...). Rows created before private names
   * existed get theirs this way, never their external name: that is the
   * name of the domain Service.
   */
  async assignInternalHostname(row: WorkloadRow): Promise<WorkloadRow> {
    if (row.internal_hostname !== null) {
      return row;
    }

    for (let attempt = 1; ; attempt += 1) {
      const taken = await this.takenServiceNames(row.project_id, row.id);

      try {
        return await this.setInternalHostname(
          row.id,
          pickInternalHostname(row.name, taken),
        );
      } catch (error) {
        if (attempt >= 3 || !(error instanceof ConflictException)) {
          throw error;
        }
      }
    }
  }

  /**
   * Writes the headless Service of a deployed service and removes private
   * Services it left under older names. Neither touches the Deployment, so
   * pods do not roll. A Service of that name that this workload's private
   * network does not own (another workload, the domain Service, anything
   * created by hand) is never taken over.
   */
  async ensureInternalService(row: WorkloadRow): Promise<void> {
    const hostname = row.internal_hostname;

    if (hostname === null) {
      return;
    }

    if (hostname === row.external_name) {
      throw new ConflictException(INTERNAL_HOSTNAME_TAKEN_MESSAGE);
    }

    const namespace = projectNamespace(row.project_id);
    const body = buildInternalService(toNetworkInput(row), hostname);
    let existing: V1Service | null = null;

    try {
      existing = await this.kubernetes.coreV1.readNamespacedService({
        name: hostname,
        namespace,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }
    }

    let create = true;

    if (existing !== null) {
      if (!isOwnInternalService(existing, row.id)) {
        throw new ConflictException(INTERNAL_HOSTNAME_TAKEN_MESSAGE);
      }

      if (
        existing.spec?.clusterIP === 'None' &&
        existing.spec.selector?.[WORKLOAD_ID_LABEL] === row.id
      ) {
        create = false;
      } else {
        // The cluster IP is immutable, so a different shape is recreated.
        await this.deleteServiceNamed(hostname, namespace);
      }
    }

    if (create) {
      try {
        await this.kubernetes.coreV1.createNamespacedService({
          namespace,
          body,
        });
      } catch (error) {
        // Created concurrently by another write of the same workload.
        if (getKubernetesStatusCode(error) !== 409) {
          throw error;
        }
      }
    }

    // Housekeeping: a stale name keeps resolving until the next pass, but
    // the current one already answers.
    try {
      await this.pruneInternalServices(row, hostname);
    } catch (error) {
      this.logger.warn(
        `Could not remove old private Services of workload ${row.id}: ${describeError(error)}`,
      );
    }
  }

  /**
   * Renames the private hostname. Applies at once: the new name answers
   * before the old one goes away. A service that was never deployed only
   * stores it; its first deploy writes the Service. The caller runs it in the
   * workload's write queue, so a deploy cannot bring the old name back.
   */
  async renameInternalHostname(
    row: WorkloadRow,
    payload: UpdateInternalHostnamePayload,
  ): Promise<WorkloadRow> {
    const hostname = normalizeInternalHostname(payload?.internal_hostname);
    const previous = row.internal_hostname;

    if (hostname === previous) {
      return row;
    }

    if ((await this.takenServiceNames(row.project_id, row.id)).has(hostname)) {
      throw new ConflictException(INTERNAL_HOSTNAME_TAKEN_MESSAGE);
    }

    const updated = await this.setInternalHostname(row.id, hostname);

    if (updated.last_deployed_at === null) {
      return updated;
    }

    try {
      await this.ensureInternalService(updated);
    } catch (error) {
      try {
        await this.setInternalHostname(row.id, previous);
      } catch (rollbackError) {
        this.logger.error(
          `Workload ${row.id} keeps private hostname ${hostname} without a Service; the next deploy writes it: ${describeError(rollbackError)}`,
        );
      }

      throw this.mapClusterError(error);
    }

    return updated;
  }

  /**
   * Deletes the private Services of a workload except `keep`. They are
   * found by label, so names left by a failed or raced rename go too.
   */
  private async pruneInternalServices(
    row: WorkloadRow,
    keep: string | null,
  ): Promise<void> {
    const namespace = projectNamespace(row.project_id);
    let services: V1Service[];

    try {
      services = (
        await this.kubernetes.coreV1.listNamespacedService({
          namespace,
          labelSelector: `${WORKLOAD_ID_LABEL}=${row.id},${SERVICE_ROLE_LABEL}=${INTERNAL_SERVICE_ROLE}`,
        })
      ).items;
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return;
      }

      throw error;
    }

    for (const service of services) {
      const name = service.metadata?.name;

      if (name && name !== keep && name !== row.external_name) {
        await this.deleteServiceNamed(name, namespace);
      }
    }
  }

  /**
   * Every Kubernetes Service name used in a project: the private hostnames
   * and the external names (the domain Service) of its workloads. The
   * private hostname of `excludeId` is left out, so it can be kept.
   */
  async takenServiceNames(
    projectId: string,
    excludeId?: string,
  ): Promise<Set<string>> {
    const rows = await this.db
      .select({
        id: workload.id,
        external_name: workload.external_name,
        internal_hostname: workload.internal_hostname,
      })
      .from(workload)
      .where(eq(workload.project_id, projectId));
    const taken = new Set<string>();

    for (const row of rows) {
      taken.add(row.external_name);

      if (row.internal_hostname !== null && row.id !== excludeId) {
        taken.add(row.internal_hostname);
      }
    }

    return taken;
  }

  onModuleInit(): void {
    if (process.env.WORKLOAD_DOMAIN_VERIFIER === '0') {
      return;
    }

    this.timer = setInterval(() => {
      void this.verifyPending();
    }, VERIFY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async list(projectId: string, workloadId: string): Promise<WorkloadDomains> {
    const row = await this.findWorkload(projectId, workloadId);
    const [expectedIp, domains] = await Promise.all([
      this.dns.expectedIp(),
      this.findDomains(row.id),
    ]);

    return {
      expected_ip: expectedIp,
      generated_suffix: expectedIp ? generatedSuffix(expectedIp) : null,
      suggested_label: suggestedLabel(row.name, expectedIp),
      domains: domains.map((domain) => this.toDomain(domain, expectedIp)),
    };
  }

  /** Creates the service's sslip.io domain and routes it right away. */
  async generate(
    projectId: string,
    workloadId: string,
    payload: GenerateWorkloadDomainPayload,
  ): Promise<WorkloadDomain> {
    const row = await this.findWorkload(projectId, workloadId);
    const port = normalizePort(payload?.port);
    const expectedIp = await this.dns.expectedIp();

    if (!expectedIp) {
      throw new ConflictException(PUBLIC_IP_UNKNOWN_MESSAGE);
    }

    const hostname = generatedHostname(payload?.label, expectedIp);
    const existing = await this.findDomains(row.id);

    if (existing.some(({ kind }) => kind === 'generated')) {
      throw new ConflictException(GENERATED_EXISTS_MESSAGE);
    }

    await this.traefik.assertAvailable();

    const domain = await this.insert({
      workload_id: row.id,
      hostname,
      kind: 'generated',
      port,
      status: 'generated',
      status_message: GENERATED_ISSUING_MESSAGE,
      routed: true,
      verified_at: new Date(),
      certificate_status: 'pending',
    });

    try {
      await this.publish(row, domain);
    } catch (error) {
      // Nothing half-made is left behind: the user can simply try again.
      await this.db
        .delete(workloadDomain)
        .where(eq(workloadDomain.id, domain.id));
      await this.unpublishQuietly(row, domain);
      throw this.mapClusterError(error);
    }

    return this.toDomain(domain, expectedIp);
  }

  /**
   * Saves a custom domain as `verification` and returns the record to create.
   * Nothing is written to the cluster until the record verifies.
   */
  async addCustom(
    projectId: string,
    workloadId: string,
    payload: AddWorkloadDomainPayload,
  ): Promise<WorkloadDomain> {
    const row = await this.findWorkload(projectId, workloadId);
    const hostname = normalizeCustomHostname(payload?.hostname);
    const port = normalizePort(payload?.port);

    await this.assertNotControlPlane(hostname);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(workloadDomain)
      .where(
        and(
          eq(workloadDomain.workload_id, row.id),
          eq(workloadDomain.kind, 'custom'),
        ),
      );

    if (total >= CUSTOM_DOMAINS_MAX) {
      throw new ConflictException(CUSTOM_LIMIT_MESSAGE);
    }

    const domain = await this.insert({
      workload_id: row.id,
      hostname,
      kind: 'custom',
      port,
      status: 'verification',
      status_message: AWAITING_RECORD_MESSAGE,
      routed: false,
    });

    const dns = await this.dns.check(hostname);
    const advanced = await this.advanceUnrouted(row, domain, dns, false);

    return this.toDomain(advanced, dns.expected_ip, dns);
  }

  /** Changes the target port; a routed domain switches over immediately. */
  async update(
    projectId: string,
    workloadId: string,
    domainId: string,
    payload: UpdateWorkloadDomainPayload,
  ): Promise<WorkloadDomain> {
    const row = await this.findWorkload(projectId, workloadId);
    const domain = await this.findDomain(row.id, domainId);
    const port = normalizePort(payload?.port);

    if (port === domain.port) {
      return this.toDomain(domain, await this.dns.expectedIp());
    }

    const updated = await this.patch(domain.id, { port });

    if (updated.routed) {
      try {
        await this.syncService(row);
        for (const body of buildDomainRoutes(toNetworkInput(row), updated)) {
          await this.traefik.upsert(body);
        }
      } catch (error) {
        throw this.mapClusterError(error);
      }
    }

    return this.toDomain(updated, await this.dns.expectedIp());
  }

  /**
   * Checks a domain now: routes a custom domain once its record verifies,
   * reports the certificate once it is served, and restarts a failed one.
   */
  async verify(
    projectId: string,
    workloadId: string,
    domainId: string,
  ): Promise<WorkloadDomain> {
    const row = await this.findWorkload(projectId, workloadId);
    let domain = await this.findDomain(row.id, domainId);

    if (domain.kind === 'generated') {
      if (domain.certificate_status === 'failed') {
        // Give issuance another full window before reporting it again.
        domain = await this.patch(domain.id, {
          certificate_status: 'pending',
          status_message: GENERATED_ISSUING_MESSAGE,
          verified_at: new Date(),
        });
      }

      if (domain.routed && domain.certificate_status !== 'issued') {
        domain = await this.advanceRouted(row, domain);
      }

      return this.toDomain(domain, await this.dns.expectedIp());
    }

    if (domain.status === 'failed') {
      domain = await this.patch(domain.id, {
        status: 'verification',
        status_message: AWAITING_RECORD_MESSAGE,
        verified_at: null,
        certificate_status: 'pending',
      });
    }

    const dns = await this.dns.check(domain.hostname);

    if (domain.status === 'verification') {
      domain = domain.routed
        ? await this.advanceRouted(row, domain)
        : await this.advanceUnrouted(row, domain, dns, true);
    }

    return this.toDomain(domain, dns.expected_ip, dns);
  }

  async remove(
    projectId: string,
    workloadId: string,
    domainId: string,
  ): Promise<void> {
    const row = await this.findWorkload(projectId, workloadId);
    const domain = await this.findDomain(row.id, domainId);

    try {
      await this.unpublish(row, domain);
      await this.db
        .delete(workloadDomain)
        .where(eq(workloadDomain.id, domain.id));
      await this.syncService(row);
    } catch (error) {
      throw this.mapClusterError(error);
    }
  }

  /**
   * Deletes the routes and both Services of a workload that is being
   * deleted. The rows go with the workload through the foreign key.
   */
  async removeAll(row: WorkloadRow): Promise<void> {
    const domains = await this.findDomains(row.id);

    for (const domain of domains) {
      await this.unpublish(row, domain);
    }

    await this.deleteService(row);
    await this.pruneInternalServices(row, null);
  }

  /**
   * One background pass over every custom domain still in verification and
   * every generated domain without a trusted certificate. A generated domain
   * whose certificate failed keeps being checked: Traefik keeps retrying.
   */
  async verifyPending(): Promise<void> {
    if (this.verifying) {
      return;
    }

    this.verifying = true;

    try {
      const pendingQuery = (condition: SQL | undefined) =>
        this.db
          .select({ domain: workloadDomain, workload })
          .from(workloadDomain)
          .innerJoin(workload, eq(workload.id, workloadDomain.workload_id))
          .where(condition);
      const [custom, generated] = await Promise.all([
        pendingQuery(eq(workloadDomain.status, 'verification')),
        pendingQuery(
          and(
            eq(workloadDomain.kind, 'generated'),
            eq(workloadDomain.routed, true),
          ),
        ),
      ]);
      const pending = [
        ...custom,
        ...generated.filter(
          ({ domain }) => domain.certificate_status !== 'issued',
        ),
      ];

      for (const { domain, workload: row } of pending) {
        try {
          if (domain.routed) {
            await this.advanceRouted(row, domain);
          } else {
            const dns = await this.dns.check(domain.hostname);
            await this.advanceUnrouted(row, domain, dns, false);
          }
        } catch (error) {
          this.logger.warn(
            `Could not check domain ${domain.hostname}: ${describeError(error)}`,
          );
        }
      }
    } catch (error) {
      // The API starts before migrations in local development.
      this.logger.warn(
        `Could not list pending domains: ${describeError(error)}`,
      );
    } finally {
      this.verifying = false;
    }
  }

  /**
   * A custom domain without routes: once its A record points to the server,
   * publish its routes and start waiting for the certificate. `strict` lets a
   * cluster that cannot issue certificates fail the request; the background
   * pass records it on the domain instead.
   */
  private async advanceUnrouted(
    row: WorkloadRow,
    domain: WorkloadDomainRow,
    dns: DnsCheck,
    strict: boolean,
  ): Promise<WorkloadDomainRow> {
    if (dns.status !== 'valid') {
      const message = describeDnsCheck(dns);

      return message === domain.status_message
        ? domain
        : this.patch(domain.id, { status_message: message });
    }

    try {
      await this.traefik.assertAvailable();
    } catch (error) {
      if (strict) {
        throw error;
      }

      const message =
        error instanceof HttpException ? error.message : describeError(error);

      return this.patch(domain.id, { status_message: message });
    }

    const routed = await this.patch(domain.id, {
      routed: true,
      verified_at: new Date(),
      certificate_status: 'pending',
      status_message: describeDnsCheck(dns),
    });

    try {
      await this.publish(row, routed);
    } catch (error) {
      await this.unpublishQuietly(row, routed);
      await this.patch(domain.id, { routed: false, verified_at: null });
      throw this.mapClusterError(error);
    }

    return routed;
  }

  /**
   * A routed domain waiting for its certificate: issued once the hostname
   * serves trusted HTTPS. After the timeout a custom domain fails and loses
   * its routes; a generated one keeps them, since its DNS is always right and
   * Traefik keeps retrying, and only reports the failure.
   */
  private async advanceRouted(
    row: WorkloadRow,
    domain: WorkloadDomainRow,
  ): Promise<WorkloadDomainRow> {
    const probe = await this.traefik.probe(domain.hostname);

    if (probe.ok) {
      this.logger.log(`Domain ${domain.hostname} is serving HTTPS`);
      return this.patch(domain.id, {
        certificate_status: 'issued',
        status_message: null,
        ...(domain.kind === 'custom' ? { status: 'success' as const } : {}),
      });
    }

    if (domain.certificate_status === 'failed') {
      return domain;
    }

    const startedAt = domain.verified_at?.getTime() ?? Date.now();

    if (Date.now() - startedAt < CERTIFICATE_TIMEOUT_MS) {
      return domain;
    }

    if (domain.kind === 'generated') {
      this.logger.warn(
        `Domain ${domain.hostname} has no certificate yet: ${probe.error ?? 'unknown error'}`,
      );
      return this.patch(domain.id, {
        certificate_status: 'failed',
        status_message: GENERATED_CERTIFICATE_TIMEOUT_MESSAGE,
      });
    }

    this.logger.warn(
      `Domain ${domain.hostname} did not get a certificate: ${probe.error ?? 'unknown error'}`,
    );
    await this.unpublish(row, domain);
    const failed = await this.patch(domain.id, {
      status: 'failed',
      status_message: CERTIFICATE_TIMEOUT_MESSAGE,
      routed: false,
      certificate_status: 'failed',
    });
    await this.syncService(row);

    return failed;
  }

  /** Lets Traefik in, then writes the Service and the domain's routes. */
  private async publish(
    row: WorkloadRow,
    domain: WorkloadDomainRow,
  ): Promise<void> {
    const input = toNetworkInput(row);

    await this.isolation.ensure(row.project_id);
    await this.traefik.upsert(buildHttpsRedirectMiddleware(input));
    await this.syncService(row);

    for (const body of buildDomainRoutes(input, domain)) {
      await this.traefik.upsert(body);
    }
  }

  private async unpublish(
    row: WorkloadRow,
    domain: WorkloadDomainRow,
  ): Promise<void> {
    const namespace = projectNamespace(row.project_id);

    for (const name of [
      domainRouteName(domain.id),
      domainHttpRouteName(domain.id),
    ]) {
      await this.traefik.delete('IngressRoute', namespace, name);
    }
  }

  private async unpublishQuietly(
    row: WorkloadRow,
    domain: WorkloadDomainRow,
  ): Promise<void> {
    try {
      await this.unpublish(row, domain);
      await this.syncService(row);
    } catch (error) {
      this.logger.warn(
        `Could not clean up domain ${domain.hostname}: ${describeError(error)}`,
      );
    }
  }

  /**
   * Makes the Service expose exactly the ports of the routed domains, and
   * deletes it when none is left.
   */
  private async syncService(row: WorkloadRow): Promise<void> {
    const routed = (await this.findDomains(row.id)).filter(
      (domain) => domain.routed,
    );
    const ports = servicePorts(routed);

    if (ports.length === 0) {
      await this.deleteService(row);
      return;
    }

    const namespace = projectNamespace(row.project_id);
    const input = toNetworkInput(row);
    let resourceVersion: string | undefined;

    try {
      const existing = await this.kubernetes.coreV1.readNamespacedService({
        name: row.external_name,
        namespace,
      });
      resourceVersion = existing.metadata?.resourceVersion;
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }
    }

    if (resourceVersion === undefined) {
      await this.kubernetes.coreV1.createNamespacedService({
        namespace,
        body: buildNetworkService(input, ports),
      });
      return;
    }

    // JSON Patch of the ports only: a full replace would have to carry the
    // allocated ClusterIP back.
    await this.kubernetes.coreV1.patchNamespacedService({
      name: row.external_name,
      namespace,
      body: [
        {
          op: 'replace',
          path: '/spec/ports',
          value: buildNetworkService(input, ports).spec?.ports,
        },
      ],
    });
  }

  private deleteService(row: WorkloadRow): Promise<void> {
    return this.deleteServiceNamed(
      row.external_name,
      projectNamespace(row.project_id),
    );
  }

  private async deleteServiceNamed(
    name: string,
    namespace: string,
  ): Promise<void> {
    try {
      await this.kubernetes.coreV1.deleteNamespacedService({ name, namespace });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }
    }
  }

  private async setInternalHostname(
    id: string,
    hostname: string | null,
  ): Promise<WorkloadRow> {
    try {
      const [row] = await this.db
        .update(workload)
        .set({ internal_hostname: hostname })
        .where(eq(workload.id, id))
        .returning();

      if (!row) {
        throw new NotFoundException('Workload not found');
      }

      return row;
    } catch (error) {
      if (uniqueViolation(error) === INTERNAL_HOSTNAME_CONSTRAINT) {
        throw new ConflictException(INTERNAL_HOSTNAME_TAKEN_MESSAGE);
      }

      throw error;
    }
  }

  private async assertNotControlPlane(hostname: string): Promise<void> {
    const [settings] = await this.db
      .select({
        current: systemSetting.control_plane_url,
        pending: systemSetting.pending_control_plane_url,
      })
      .from(systemSetting)
      .limit(1);
    const taken = [settings?.current, settings?.pending]
      .filter((url): url is string => Boolean(url))
      .map((url) => new URL(url).hostname);

    if (taken.includes(hostname)) {
      throw new ConflictException(CONTROL_PLANE_HOSTNAME_MESSAGE);
    }
  }

  private async insert(
    values: typeof workloadDomain.$inferInsert,
  ): Promise<WorkloadDomainRow> {
    try {
      const [row] = await this.db
        .insert(workloadDomain)
        .values(values)
        .returning();
      return row;
    } catch (error) {
      const constraint = uniqueViolation(error);

      if (constraint === GENERATED_UNIQUE_CONSTRAINT) {
        throw new ConflictException(GENERATED_EXISTS_MESSAGE);
      }

      if (constraint !== null) {
        throw new ConflictException(HOSTNAME_TAKEN_MESSAGE);
      }

      throw error;
    }
  }

  private async patch(
    id: string,
    values: Partial<
      Pick<
        WorkloadDomainRow,
        | 'port'
        | 'status'
        | 'status_message'
        | 'routed'
        | 'verified_at'
        | 'certificate_status'
      >
    >,
  ): Promise<WorkloadDomainRow> {
    const [row] = await this.db
      .update(workloadDomain)
      .set(values)
      .where(eq(workloadDomain.id, id))
      .returning();

    if (!row) {
      throw new NotFoundException(DOMAIN_NOT_FOUND_MESSAGE);
    }

    return row;
  }

  private async findWorkload(
    projectId: string,
    workloadId: string,
  ): Promise<WorkloadRow> {
    const [row] = await this.db
      .select()
      .from(workload)
      .where(
        and(eq(workload.id, workloadId), eq(workload.project_id, projectId)),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Workload not found');
    }

    if (!isContainerWorkload(row.type)) {
      throw new BadRequestException(NOT_DOCKER_MESSAGE);
    }

    return row;
  }

  private findDomains(workloadId: string): Promise<WorkloadDomainRow[]> {
    return this.db
      .select()
      .from(workloadDomain)
      .where(eq(workloadDomain.workload_id, workloadId))
      .orderBy(asc(workloadDomain.created_at));
  }

  private async findDomain(
    workloadId: string,
    domainId: string,
  ): Promise<WorkloadDomainRow> {
    const [row] = await this.db
      .select()
      .from(workloadDomain)
      .where(
        and(
          eq(workloadDomain.id, domainId),
          eq(workloadDomain.workload_id, workloadId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException(DOMAIN_NOT_FOUND_MESSAGE);
    }

    return row;
  }

  private mapClusterError(error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    this.logger.warn(`Kubernetes request failed: ${describeError(error)}`);

    return toNestException(error);
  }

  private toDomain(
    row: WorkloadDomainRow,
    expectedIp: string | null,
    dns: DnsCheck | null = null,
  ): WorkloadDomain {
    return {
      id: row.id,
      workload_id: row.workload_id,
      hostname: row.hostname,
      url: `https://${row.hostname}`,
      kind: row.kind,
      port: row.port,
      status: row.status,
      status_message: row.status_message,
      routed: row.routed,
      certificate: toCertificate(row),
      dns_records:
        row.kind === 'custom' && expectedIp
          ? [{ type: 'A', name: row.hostname, value: expectedIp }]
          : [],
      dns,
      verified_at: row.verified_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
