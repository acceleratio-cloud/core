import { randomUUID } from 'node:crypto';
import type { V1Service } from '@kubernetes/client-node';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DnsCheck } from '@acceleratio/shared';
import { getTableName, type Table } from 'drizzle-orm';
import type { ProjectDnsService } from '@/application/project/project-dns.service';
import type { ProjectIsolationService } from '@/application/project/project-isolation.service';
import type { ControlPlaneDnsService } from '@/application/system/control-plane-dns.service';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { TraefikClient } from '@/vendor/traefik/traefik.client';
import type { WorkloadDomainRow } from '../../schemas/workload-domain.schema';
import type { WorkloadRow } from '../../schemas/workload.schema';
import {
  CERTIFICATE_TIMEOUT_MESSAGE,
  GENERATED_CERTIFICATE_TIMEOUT_MESSAGE,
  GENERATED_ISSUING_MESSAGE,
  ISSUING_CERTIFICATE_MESSAGE,
} from '../docker-workload-network.domains';
import {
  INTERNAL_HOSTNAME_TAKEN_MESSAGE,
  INVALID_INTERNAL_HOSTNAME_MESSAGE,
} from '../docker-workload-network.internal';
import {
  CERTIFICATE_TIMEOUT_MS,
  CONTROL_PLANE_HOSTNAME_MESSAGE,
  CUSTOM_LIMIT_MESSAGE,
  DockerWorkloadNetworkService,
  GENERATED_EXISTS_MESSAGE,
  HOSTNAME_TAKEN_MESSAGE,
  NOT_DOCKER_MESSAGE,
} from '../docker-workload-network.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('@/application/project/project-isolation.service', () => ({
  ProjectIsolationService: class ProjectIsolationService {},
}));
jest.mock('@/application/project/project-dns.service', () => ({
  ProjectDnsService: class ProjectDnsService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const externalName = 'my-api-3f9a1b2c';
const namespace = `project-${projectId}`;
const ip = '203.0.113.10';

const workloadRow = (overrides: Partial<WorkloadRow> = {}): WorkloadRow => ({
  id: workloadId,
  project_id: projectId,
  name: 'My API',
  type: 'docker',
  active_version_id: null,
  draft_config: null,
  position: { x: 0, y: 0 },
  external_name: externalName,
  internal_hostname: 'my-api',
  storage_class_id: null,
  last_deployed_at: null,
  created_at: new Date('2026-11-01T09:00:00.000Z'),
  updated_at: new Date('2026-11-01T09:00:00.000Z'),
  ...overrides,
});

/** Values bound in a Drizzle condition, collected from its `Param` chunks. */
const queryParams = (node: unknown): unknown[] => {
  const values: unknown[] = [];
  const visit = (current: unknown): void => {
    if (typeof current !== 'object' || current === null) {
      return;
    }
    const record = current as { value?: unknown; queryChunks?: unknown };
    if (record.constructor?.name === 'Param') {
      values.push(record.value);
    }
    if (Array.isArray(record.queryChunks)) {
      record.queryChunks.forEach(visit);
    }
  };
  visit(node);
  return values;
};

/** A row matches when every bound value equals one of its fields. */
const matches = (row: object, condition: unknown): boolean => {
  const fields = Object.values(row);
  return queryParams(condition).every((value) => fields.includes(value));
};

class UniqueViolation extends Error {
  code = '23505';
  constructor(readonly constraint: string) {
    super('duplicate key');
  }
}

/**
 * Just enough of Drizzle for this service: `workload`, `workload_domain` and
 * `system_setting`, filtered by the equality conditions the service uses.
 */
const createDatabase = (workloads: WorkloadRow[]) => {
  const domains: WorkloadDomainRow[] = [];
  const settings: Array<Record<string, unknown>> = [];
  const tableRows = (table: Table): object[] => {
    switch (getTableName(table)) {
      case 'workload':
        return workloads;
      case 'workload_domain':
        return domains;
      default:
        return settings;
    }
  };

  const select = (fields?: Record<string, unknown>) => ({
    from: (table: Table) => {
      let joined = false;
      const run = (condition?: unknown) => {
        let rows = tableRows(table).filter((row) =>
          condition === undefined ? true : matches(row, condition),
        );
        if (fields && 'total' in fields) {
          return [{ total: rows.length }];
        }
        if (joined) {
          return rows.map((domain) => ({
            domain,
            workload: workloads.find(
              (row) => row.id === (domain as WorkloadDomainRow).workload_id,
            ),
          }));
        }
        if (fields && getTableName(table) === 'system_setting') {
          rows = rows.map((row) => ({
            current: (row as { control_plane_url?: string }).control_plane_url,
            pending: (row as { pending_control_plane_url?: string })
              .pending_control_plane_url,
          }));
        }
        return rows;
      };
      const query = {
        innerJoin: () => {
          joined = true;
          return query;
        },
        where: (condition: unknown) => {
          const result = run(condition);
          return Object.assign(Promise.resolve(result), {
            limit: () => Promise.resolve(result),
            orderBy: () => Promise.resolve(result),
          });
        },
        limit: () => Promise.resolve(run()),
      };
      return query;
    },
  });

  const insert = () => ({
    values: (values: Partial<WorkloadDomainRow>) => ({
      returning: () => {
        if (domains.some((row) => row.hostname === values.hostname)) {
          return Promise.reject(
            new UniqueViolation('workload_domain_hostname_unique'),
          );
        }
        if (
          values.kind === 'generated' &&
          domains.some(
            (row) =>
              row.kind === 'generated' &&
              row.workload_id === values.workload_id,
          )
        ) {
          return Promise.reject(
            new UniqueViolation('workload_domain_generated_unique'),
          );
        }
        const now = new Date();
        const row: WorkloadDomainRow = {
          id: randomUUID(),
          status_message: null,
          routed: false,
          certificate_status: 'pending',
          verified_at: null,
          created_at: now,
          updated_at: now,
          ...values,
        } as WorkloadDomainRow;
        domains.push(row);
        return Promise.resolve([row]);
      },
    }),
  });

  const update = (table: Table) => ({
    set: (values: Record<string, unknown>) => ({
      where: (condition: unknown) => ({
        returning: () => {
          const updated = (tableRows(table) as WorkloadDomainRow[])
            .filter((row) => matches(row, condition))
            .map((row) =>
              Object.assign(row, values, { updated_at: new Date() }),
            );
          return Promise.resolve(updated.map((row) => ({ ...row })));
        },
      }),
    }),
  });

  const remove = () => ({
    where: (condition: unknown) => {
      for (let i = domains.length - 1; i >= 0; i -= 1) {
        if (matches(domains[i], condition)) {
          domains.splice(i, 1);
        }
      }
      return Promise.resolve();
    },
  });

  return {
    db: { select, insert, update, delete: remove } as unknown as Database,
    domains,
    settings,
  };
};

const dnsCheck = (hostname: string, status: DnsCheck['status']): DnsCheck => ({
  hostname,
  expected_ip: ip,
  records: status === 'valid' ? [ip] : [],
  aaaa_records: [],
  status,
  checked_at: '2026-11-05T10:00:00.000Z',
  message: null,
});

const createService = (workloads: WorkloadRow[] = [workloadRow()]) => {
  const database = createDatabase(workloads);
  const coreV1 = {
    readNamespacedService: jest.fn().mockRejectedValue({ code: 404 }),
    listNamespacedService: jest.fn().mockResolvedValue({ items: [] }),
    createNamespacedService: jest.fn().mockResolvedValue({}),
    patchNamespacedService: jest.fn().mockResolvedValue({}),
    deleteNamespacedService: jest.fn().mockResolvedValue({}),
  };
  const appsV1 = {
    readNamespacedDeployment: jest.fn(),
    replaceNamespacedDeployment: jest.fn(),
    patchNamespacedDeployment: jest.fn(),
  };
  const kubernetes = { coreV1, appsV1 } as unknown as KubernetesService;
  const traefik = {
    assertAvailable: jest.fn().mockResolvedValue(undefined),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    probe: jest.fn().mockResolvedValue({ ok: false, error: 'TLS' }),
  };
  const dns = {
    expectedIp: jest.fn().mockResolvedValue(ip),
    check: jest.fn((hostname: string) =>
      Promise.resolve(dnsCheck(hostname, 'missing')),
    ),
  };
  const isolation = { ensure: jest.fn().mockResolvedValue(undefined) };
  const projectDns = { ensure: jest.fn().mockResolvedValue(undefined) };
  const service = new DockerWorkloadNetworkService(
    database.db,
    kubernetes,
    traefik as unknown as TraefikClient,
    dns as unknown as ControlPlaneDnsService,
    isolation as unknown as ProjectIsolationService,
    projectDns as unknown as ProjectDnsService,
  );

  return {
    service,
    coreV1,
    appsV1,
    traefik,
    dns,
    isolation,
    projectDns,
    workloads,
    ...database,
  };
};

const upsertedRoutes = (traefik: { upsert: jest.Mock }) =>
  (
    traefik.upsert.mock.calls as Array<
      [{ kind: string; metadata: { name: string } }]
    >
  )
    .map(([body]) => body)
    .filter((body) => body.kind === 'IngressRoute');

describe('DockerWorkloadNetworkService', () => {
  describe('list', () => {
    it('returns the suffix and a label suggested from the service name', async () => {
      const { service } = createService();

      await expect(service.list(projectId, workloadId)).resolves.toEqual({
        expected_ip: ip,
        generated_suffix: '-203-0-113-10.sslip.io',
        suggested_label: 'my-api',
        domains: [],
      });
    });

    it('rejects workloads that are not Docker services', async () => {
      const { service } = createService([workloadRow({ type: 's3_bucket' })]);

      await expect(service.list(projectId, workloadId)).rejects.toThrow(
        NOT_DOCKER_MESSAGE,
      );
    });
  });

  describe('generate', () => {
    it('routes the sslip.io domain right away without touching the Deployment', async () => {
      const { service, traefik, coreV1, appsV1, isolation } = createService();

      const domain = await service.generate(projectId, workloadId, {
        label: 'api',
        port: 8080,
      });

      expect(domain).toMatchObject({
        hostname: 'api-203-0-113-10.sslip.io',
        url: 'https://api-203-0-113-10.sslip.io',
        kind: 'generated',
        status: 'generated',
        port: 8080,
        routed: true,
        certificate: 'issuing',
        status_message: GENERATED_ISSUING_MESSAGE,
        dns_records: [],
      });
      expect(isolation.ensure).toHaveBeenCalledWith(projectId);
      expect(upsertedRoutes(traefik).map((body) => body.metadata.name)).toEqual(
        [`domain-${domain.id}`, `domain-${domain.id}-http`],
      );
      const [created] = coreV1.createNamespacedService.mock.calls[0] as [
        { namespace: string; body: V1Service },
      ];
      expect(created.namespace).toBe(namespace);
      expect(created.body.spec?.ports?.map(({ port }) => port)).toEqual([8080]);
      expect(appsV1.readNamespacedDeployment).not.toHaveBeenCalled();
      expect(appsV1.replaceNamespacedDeployment).not.toHaveBeenCalled();
      expect(appsV1.patchNamespacedDeployment).not.toHaveBeenCalled();
    });

    it('allows one generated domain per service', async () => {
      const { service } = createService();
      await service.generate(projectId, workloadId, { label: 'api', port: 80 });

      await expect(
        service.generate(projectId, workloadId, { label: 'web', port: 80 }),
      ).rejects.toThrow(GENERATED_EXISTS_MESSAGE);
    });

    it('requires a port', async () => {
      const { service } = createService();

      await expect(
        service.generate(projectId, workloadId, {
          label: 'api',
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('fails when the cluster cannot issue certificates, saving nothing', async () => {
      const { service, traefik, domains } = createService();
      traefik.assertAvailable.mockRejectedValue(
        new ConflictException('no traefik'),
      );

      await expect(
        service.generate(projectId, workloadId, { label: 'api', port: 80 }),
      ).rejects.toThrow('no traefik');
      expect(domains).toHaveLength(0);
    });

    it('removes the row again when publishing fails', async () => {
      const { service, traefik, domains } = createService();
      traefik.upsert.mockRejectedValueOnce(new Error('boom'));

      await expect(
        service.generate(projectId, workloadId, { label: 'api', port: 80 }),
      ).rejects.toBeDefined();
      expect(domains).toHaveLength(0);
    });
  });

  describe('addCustom', () => {
    it('saves the domain in verification and writes nothing to the cluster', async () => {
      const { service, traefik, coreV1 } = createService();

      const domain = await service.addCustom(projectId, workloadId, {
        hostname: 'App.Example.com',
        port: 3000,
      });

      expect(domain).toMatchObject({
        hostname: 'app.example.com',
        kind: 'custom',
        status: 'verification',
        routed: false,
        certificate: 'waiting',
        port: 3000,
        dns_records: [{ type: 'A', name: 'app.example.com', value: ip }],
      });
      expect(domain.dns?.status).toBe('missing');
      expect(traefik.upsert).not.toHaveBeenCalled();
      expect(coreV1.createNamespacedService).not.toHaveBeenCalled();
    });

    it('routes the domain at once when its A record already points here', async () => {
      const { service, dns, traefik } = createService();
      dns.check.mockResolvedValue(dnsCheck('app.example.com', 'valid'));

      const domain = await service.addCustom(projectId, workloadId, {
        hostname: 'app.example.com',
        port: 3000,
      });

      expect(domain).toMatchObject({
        status: 'verification',
        routed: true,
        status_message: ISSUING_CERTIFICATE_MESSAGE,
      });
      expect(domain.verified_at).not.toBeNull();
      expect(upsertedRoutes(traefik)).toHaveLength(2);
    });

    it('rejects a hostname used by another service', async () => {
      const { service } = createService();
      await service.addCustom(projectId, workloadId, {
        hostname: 'app.example.com',
        port: 80,
      });

      await expect(
        service.addCustom(projectId, workloadId, {
          hostname: 'app.example.com',
          port: 80,
        }),
      ).rejects.toThrow(HOSTNAME_TAKEN_MESSAGE);
    });

    it('rejects the console hostname', async () => {
      const { service, settings } = createService();
      settings.push({ id: 1, control_plane_url: 'https://cloud.example.com' });

      await expect(
        service.addCustom(projectId, workloadId, {
          hostname: 'cloud.example.com',
          port: 80,
        }),
      ).rejects.toThrow(CONTROL_PLANE_HOSTNAME_MESSAGE);
    });

    it('caps custom domains at 20', async () => {
      const { service } = createService();
      for (let i = 0; i < 20; i += 1) {
        await service.addCustom(projectId, workloadId, {
          hostname: `app${i}.example.com`,
          port: 80,
        });
      }

      await expect(
        service.addCustom(projectId, workloadId, {
          hostname: 'one-more.example.com',
          port: 80,
        }),
      ).rejects.toThrow(CUSTOM_LIMIT_MESSAGE);
    });
  });

  describe('verification', () => {
    const addPending = async () => {
      const context = createService();
      const domain = await context.service.addCustom(projectId, workloadId, {
        hostname: 'app.example.com',
        port: 3000,
      });
      return { ...context, domain };
    };

    it('publishes routes once the A record verifies', async () => {
      const { service, dns, traefik, domain } = await addPending();
      dns.check.mockResolvedValue(dnsCheck('app.example.com', 'valid'));

      const verified = await service.verify(projectId, workloadId, domain.id);

      expect(verified).toMatchObject({ status: 'verification', routed: true });
      expect(upsertedRoutes(traefik)).toHaveLength(2);
    });

    it('reports success once trusted HTTPS is served', async () => {
      const { service, dns, traefik, domain } = await addPending();
      dns.check.mockResolvedValue(dnsCheck('app.example.com', 'valid'));
      await service.verify(projectId, workloadId, domain.id);
      traefik.probe.mockResolvedValue({ ok: true });

      const verified = await service.verify(projectId, workloadId, domain.id);

      expect(verified).toMatchObject({
        status: 'success',
        certificate: 'issued',
        status_message: null,
      });
    });

    it('fails and unroutes after the certificate timeout, and can be retried', async () => {
      const { service, dns, traefik, coreV1, domains, domain } =
        await addPending();
      dns.check.mockResolvedValue(dnsCheck('app.example.com', 'valid'));
      await service.verify(projectId, workloadId, domain.id);
      domains[0].verified_at = new Date(
        Date.now() - CERTIFICATE_TIMEOUT_MS - 1000,
      );

      await service.verifyPending();

      expect(domains[0]).toMatchObject({
        status: 'failed',
        routed: false,
        certificate_status: 'failed',
        status_message: CERTIFICATE_TIMEOUT_MESSAGE,
      });
      expect(traefik.delete).toHaveBeenCalledWith(
        'IngressRoute',
        namespace,
        `domain-${domain.id}`,
      );
      expect(coreV1.deleteNamespacedService).toHaveBeenCalled();

      const retried = await service.verify(projectId, workloadId, domain.id);
      expect(retried).toMatchObject({ status: 'verification', routed: true });
    });

    it('verifies pending domains in the background', async () => {
      const { service, dns, traefik, domains } = await addPending();
      dns.check.mockResolvedValue(dnsCheck('app.example.com', 'valid'));

      await service.verifyPending();
      expect(domains[0].routed).toBe(true);

      traefik.probe.mockResolvedValue({ ok: true });
      await service.verifyPending();
      expect(domains[0].status).toBe('success');
    });

    it('records a missing Traefik on the domain in the background', async () => {
      const { service, dns, traefik, domains } = await addPending();
      dns.check.mockResolvedValue(dnsCheck('app.example.com', 'valid'));
      traefik.assertAvailable.mockRejectedValue(
        new ConflictException('no traefik'),
      );

      await service.verifyPending();

      expect(domains[0]).toMatchObject({
        routed: false,
        status: 'verification',
        status_message: 'no traefik',
      });
    });
  });

  describe('generated domain certificate', () => {
    const generate = async () => {
      const context = createService();
      const domain = await context.service.generate(projectId, workloadId, {
        label: 'api',
        port: 80,
      });
      return { ...context, domain };
    };

    it('reports the certificate as issued once trusted HTTPS is served', async () => {
      const { service, traefik, domains } = await generate();

      await service.verifyPending();
      expect(domains[0].certificate_status).toBe('pending');

      traefik.probe.mockResolvedValue({ ok: true });
      await service.verifyPending();

      expect(domains[0]).toMatchObject({
        status: 'generated',
        certificate_status: 'issued',
        status_message: null,
      });
      const [listed] = (await service.list(projectId, workloadId)).domains;
      expect(listed.certificate).toBe('issued');
    });

    it('stops probing once the certificate is issued', async () => {
      const { service, traefik } = await generate();
      traefik.probe.mockResolvedValue({ ok: true });
      await service.verifyPending();
      traefik.probe.mockClear();

      await service.verifyPending();

      expect(traefik.probe).not.toHaveBeenCalled();
    });

    it('reports a failure after the timeout but keeps the routes, and recovers', async () => {
      const { service, traefik, domains } = await generate();
      domains[0].verified_at = new Date(
        Date.now() - CERTIFICATE_TIMEOUT_MS - 1000,
      );

      await service.verifyPending();

      expect(domains[0]).toMatchObject({
        status: 'generated',
        routed: true,
        certificate_status: 'failed',
        status_message: GENERATED_CERTIFICATE_TIMEOUT_MESSAGE,
      });
      expect(traefik.delete).not.toHaveBeenCalled();

      traefik.probe.mockResolvedValue({ ok: true });
      await service.verifyPending();
      expect(domains[0].certificate_status).toBe('issued');
    });

    it('restarts the wait when checked after a failure', async () => {
      const { service, domains, domain } = await generate();
      domains[0].certificate_status = 'failed';
      domains[0].verified_at = new Date(0);

      const checked = await service.verify(projectId, workloadId, domain.id);

      expect(checked).toMatchObject({
        certificate: 'issuing',
        status_message: GENERATED_ISSUING_MESSAGE,
      });
      expect(domains[0].verified_at?.getTime()).toBeGreaterThan(0);
    });
  });

  describe('update and remove', () => {
    it('switches a routed domain to the new port without a redeploy', async () => {
      const { service, traefik, coreV1, appsV1 } = createService();
      const domain = await service.generate(projectId, workloadId, {
        label: 'api',
        port: 80,
      });
      coreV1.readNamespacedService.mockResolvedValue({
        metadata: { resourceVersion: '7' },
      });
      traefik.upsert.mockClear();

      const updated = await service.update(projectId, workloadId, domain.id, {
        port: 9000,
      });

      expect(updated.port).toBe(9000);
      expect(coreV1.patchNamespacedService).toHaveBeenCalledWith({
        name: externalName,
        namespace,
        body: [
          {
            op: 'replace',
            path: '/spec/ports',
            value: [expect.objectContaining({ port: 9000 })],
          },
        ],
      });
      expect(upsertedRoutes(traefik)).toHaveLength(2);
      expect(appsV1.replaceNamespacedDeployment).not.toHaveBeenCalled();
    });

    it('only saves the port of a domain that is not routed yet', async () => {
      const { service, traefik } = createService();
      const domain = await service.addCustom(projectId, workloadId, {
        hostname: 'app.example.com',
        port: 80,
      });

      await service.update(projectId, workloadId, domain.id, { port: 81 });

      expect(traefik.upsert).not.toHaveBeenCalled();
    });

    it('keeps the Service for the remaining domains on remove', async () => {
      const { service, dns, coreV1, traefik } = createService();
      dns.check.mockResolvedValue(dnsCheck('app.example.com', 'valid'));
      const generated = await service.generate(projectId, workloadId, {
        label: 'api',
        port: 80,
      });
      await service.addCustom(projectId, workloadId, {
        hostname: 'app.example.com',
        port: 3000,
      });
      coreV1.readNamespacedService.mockResolvedValue({
        metadata: { resourceVersion: '7' },
      });

      await service.remove(projectId, workloadId, generated.id);

      expect(traefik.delete).toHaveBeenCalledWith(
        'IngressRoute',
        namespace,
        `domain-${generated.id}-http`,
      );
      expect(coreV1.patchNamespacedService).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: [
            expect.objectContaining({
              value: [expect.objectContaining({ port: 3000 })],
            }),
          ],
        }),
      );
      expect(coreV1.deleteNamespacedService).not.toHaveBeenCalled();
    });

    it('deletes the Service with the last routed domain', async () => {
      const { service, coreV1, domains } = createService();
      const domain = await service.generate(projectId, workloadId, {
        label: 'api',
        port: 80,
      });

      await service.remove(projectId, workloadId, domain.id);

      expect(domains).toHaveLength(0);
      expect(coreV1.deleteNamespacedService).toHaveBeenCalledWith({
        name: externalName,
        namespace,
      });
    });

    it('removeAll deletes every route and the Service', async () => {
      const { service, traefik, coreV1 } = createService();
      const domain = await service.generate(projectId, workloadId, {
        label: 'api',
        port: 80,
      });

      await service.removeAll(workloadRow());

      expect(traefik.delete).toHaveBeenCalledWith(
        'IngressRoute',
        namespace,
        `domain-${domain.id}`,
      );
      expect(coreV1.deleteNamespacedService).toHaveBeenCalled();
    });
  });

  describe('private network', () => {
    const deployedAt = new Date('2026-11-01T10:00:00.000Z');
    const internalLabels = (owner = workloadId) => ({
      'acceleratio.io/workload-id': owner,
      'acceleratio.io/service-role': 'internal',
    });
    const headless = (name = 'my-api', owner = workloadId): V1Service => ({
      metadata: { name, labels: internalLabels(owner) },
      spec: {
        clusterIP: 'None',
        selector: { 'acceleratio.io/workload-id': owner },
      },
    });
    const serviceList = (items: V1Service[]) => ({ items });
    const deletedNames = (coreV1: { deleteNamespacedService: jest.Mock }) =>
      (
        coreV1.deleteNamespacedService.mock.calls as Array<[{ name: string }]>
      ).map(([request]) => request.name);

    it('creates a headless Service named by the private hostname', async () => {
      const { service, coreV1 } = createService();
      coreV1.listNamespacedService.mockResolvedValue(serviceList([]));

      await service.ensureInternalService(workloadRow());

      const [request] = coreV1.createNamespacedService.mock.calls[0] as [
        { namespace: string; body: V1Service },
      ];

      expect(request.namespace).toBe(namespace);
      expect(request.body.metadata).toMatchObject({
        name: 'my-api',
        namespace,
      });
      expect(request.body.spec).toEqual({
        clusterIP: 'None',
        selector: { 'acceleratio.io/workload-id': workloadId },
      });
    });

    it('leaves a matching Service alone', async () => {
      const { service, coreV1 } = createService();
      coreV1.readNamespacedService.mockResolvedValue(headless());
      coreV1.listNamespacedService.mockResolvedValue(serviceList([headless()]));

      await service.ensureInternalService(workloadRow());

      expect(coreV1.createNamespacedService).not.toHaveBeenCalled();
      expect(coreV1.deleteNamespacedService).not.toHaveBeenCalled();
    });

    it('recreates its own Service when it has a cluster IP', async () => {
      const { service, coreV1 } = createService();
      const existing = headless();
      existing.spec!.clusterIP = '10.43.0.20';
      coreV1.readNamespacedService.mockResolvedValue(existing);

      await service.ensureInternalService(workloadRow());

      expect(deletedNames(coreV1)).toEqual(['my-api']);
      expect(coreV1.createNamespacedService).toHaveBeenCalled();
    });

    it('never takes over a Service of another workload', async () => {
      const { service, coreV1 } = createService();
      coreV1.readNamespacedService.mockResolvedValue(
        headless('my-api', randomUUID()),
      );

      await expect(
        service.ensureInternalService(workloadRow()),
      ).rejects.toThrow(INTERNAL_HOSTNAME_TAKEN_MESSAGE);
      expect(coreV1.deleteNamespacedService).not.toHaveBeenCalled();
    });

    it('never takes over the domain Service of the same workload', async () => {
      const { service, coreV1 } = createService();
      // The domain Service carries the workload label but no internal role.
      coreV1.readNamespacedService.mockResolvedValue({
        metadata: {
          name: 'my-api',
          labels: { 'acceleratio.io/workload-id': workloadId },
        },
        spec: { clusterIP: '10.43.0.20', ports: [{ port: 80 }] },
      });

      await expect(
        service.ensureInternalService(workloadRow()),
      ).rejects.toThrow(ConflictException);
      expect(coreV1.deleteNamespacedService).not.toHaveBeenCalled();
    });

    it('refuses a hostname equal to the external name', async () => {
      const { service, coreV1 } = createService();

      await expect(
        service.ensureInternalService(
          workloadRow({ internal_hostname: externalName }),
        ),
      ).rejects.toThrow(ConflictException);
      expect(coreV1.readNamespacedService).not.toHaveBeenCalled();
    });

    it('removes private Services left under older names', async () => {
      const { service, coreV1 } = createService();
      coreV1.listNamespacedService.mockResolvedValue(
        serviceList([headless('my-api'), headless('db'), headless('old')]),
      );

      await service.ensureInternalService(workloadRow());

      expect(coreV1.listNamespacedService).toHaveBeenCalledWith({
        namespace,
        labelSelector: `acceleratio.io/workload-id=${workloadId},acceleratio.io/service-role=internal`,
      });
      expect(deletedNames(coreV1)).toEqual(['db', 'old']);
    });

    it('does nothing for a row without a private hostname', async () => {
      const { service, coreV1 } = createService();

      await service.ensureInternalService(
        workloadRow({ internal_hostname: null }),
      );

      expect(coreV1.readNamespacedService).not.toHaveBeenCalled();
    });

    it('keeps the private Service when the last domain goes away', async () => {
      const { service, coreV1 } = createService();
      const domain = await service.generate(projectId, workloadId, {
        label: 'api',
        port: 80,
      });

      await service.remove(projectId, workloadId, domain.id);

      expect(deletedNames(coreV1)).toEqual([externalName]);
    });

    it('removeAll deletes every private Service of the workload', async () => {
      const { service, coreV1 } = createService();
      coreV1.listNamespacedService.mockResolvedValue(
        serviceList([headless('my-api'), headless('db')]),
      );

      await service.removeAll(workloadRow());

      expect(deletedNames(coreV1)).toEqual([externalName, 'my-api', 'db']);
    });

    it('lists every Service name used in the project', async () => {
      const other = workloadRow({
        id: randomUUID(),
        external_name: 'db-1a2b3c4d',
        internal_hostname: 'db',
      });
      const { service } = createService([workloadRow(), other]);

      await expect(service.takenServiceNames(projectId)).resolves.toEqual(
        new Set([externalName, 'my-api', 'db-1a2b3c4d', 'db']),
      );
      await expect(
        service.takenServiceNames(projectId, workloadId),
      ).resolves.toEqual(new Set([externalName, 'db-1a2b3c4d', 'db']));
    });

    describe('assignInternalHostname', () => {
      it('gives a row created before private names a free slug, never its external name', async () => {
        const legacy = workloadRow({
          name: 'Postgres',
          internal_hostname: null,
        });
        const other = workloadRow({
          id: randomUUID(),
          external_name: 'postgres-1a2b3c4d',
          internal_hostname: 'postgres',
        });
        const { service, workloads } = createService([legacy, other]);

        const named = await service.assignInternalHostname(legacy);

        expect(named.internal_hostname).toBe('postgres-2');
        expect(workloads[0].internal_hostname).toBe('postgres-2');
      });

      it('keeps an existing hostname', async () => {
        const { service } = createService();

        await expect(
          service.assignInternalHostname(workloadRow()),
        ).resolves.toMatchObject({ internal_hostname: 'my-api' });
      });
    });

    describe('renameInternalHostname', () => {
      it('renames a deployed service: new Service first, then the old one goes', async () => {
        const row = workloadRow({ last_deployed_at: deployedAt });
        const { service, coreV1, workloads } = createService([row]);
        const order: string[] = [];
        coreV1.createNamespacedService.mockImplementation(
          ({ body }: { body: V1Service }) => {
            order.push(`create ${body.metadata?.name}`);
            return Promise.resolve({});
          },
        );
        coreV1.listNamespacedService.mockImplementation(() => {
          order.push('list');
          return Promise.resolve(
            serviceList([headless('my-api'), headless('postgres')]),
          );
        });
        coreV1.deleteNamespacedService.mockImplementation(
          ({ name }: { name: string }) => {
            order.push(`delete ${name}`);
            return Promise.resolve({});
          },
        );

        const renamed = await service.renameInternalHostname(row, {
          internal_hostname: ' Postgres.internal ',
        });

        expect(renamed.internal_hostname).toBe('postgres');
        expect(workloads[0].internal_hostname).toBe('postgres');
        expect(order).toEqual(['create postgres', 'list', 'delete my-api']);
      });

      it('only stores the name of a service that was never deployed', async () => {
        const { service, coreV1, workloads } = createService();

        await service.renameInternalHostname(workloadRow(), {
          internal_hostname: 'postgres',
        });

        expect(workloads[0].internal_hostname).toBe('postgres');
        expect(coreV1.createNamespacedService).not.toHaveBeenCalled();
      });

      it('is a no-op for the current name', async () => {
        const row = workloadRow({ last_deployed_at: deployedAt });
        const { service, coreV1 } = createService([row]);

        await service.renameInternalHostname(row, {
          internal_hostname: 'my-api',
        });

        expect(coreV1.createNamespacedService).not.toHaveBeenCalled();
      });

      it.each(['', '1db', 'db-', 'my_db', 'a'.repeat(51), 42])(
        'rejects %p',
        async (value) => {
          const { service } = createService();

          await expect(
            service.renameInternalHostname(workloadRow(), {
              internal_hostname: value as string,
            }),
          ).rejects.toThrow(INVALID_INTERNAL_HOSTNAME_MESSAGE);
        },
      );

      it.each(['db', 'db-1a2b3c4d', externalName])(
        'rejects %p, a Service name already used in the project',
        async (value) => {
          const other = workloadRow({
            id: randomUUID(),
            external_name: 'db-1a2b3c4d',
            internal_hostname: 'db',
          });
          const { service } = createService([workloadRow(), other]);

          await expect(
            service.renameInternalHostname(workloadRow(), {
              internal_hostname: value,
            }),
          ).rejects.toThrow(ConflictException);
        },
      );

      it('restores the old name when the cluster write fails', async () => {
        const row = workloadRow({ last_deployed_at: deployedAt });
        const { service, coreV1, workloads } = createService([row]);
        coreV1.createNamespacedService.mockRejectedValue({ code: 500 });

        await expect(
          service.renameInternalHostname(row, {
            internal_hostname: 'postgres',
          }),
        ).rejects.toBeDefined();
        expect(workloads[0].internal_hostname).toBe('my-api');
        expect(coreV1.deleteNamespacedService).not.toHaveBeenCalled();
      });
    });
  });
});
