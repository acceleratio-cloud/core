import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ControlPlaneDnsCheck } from '@acceleratio/shared';
import {
  getTrustedOrigins,
  setControlPlaneOrigin,
} from '@/vendor/auth/trusted-origins';
import type { Database } from '@/vendor/db/database.constants';
import type { ControlPlaneDnsService } from '../control-plane-dns.service';
import type { ControlPlaneRoutingService } from '../control-plane-routing.service';
import type { SystemSettingRow } from '../schemas/system-setting.schema';
import {
  DNS_NOT_READY_MESSAGE,
  PROVISIONING_TIMEOUT_MESSAGE,
  PROVISIONING_TIMEOUT_MS,
  SystemService,
} from '../system.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

/** In-memory stand-in for the single `system_setting` row. */
const createDatabase = (initial?: Partial<SystemSettingRow>) => {
  let row: SystemSettingRow | undefined = initial
    ? {
        id: 1,
        control_plane_url: null,
        pending_control_plane_url: null,
        pending_status: null,
        pending_error: null,
        pending_applied_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        ...initial,
      }
    : undefined;

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (values: Partial<SystemSettingRow>) => ({
        onConflictDoUpdate: ({ set }: { set: Partial<SystemSettingRow> }) => ({
          returning: () => {
            row = row
              ? { ...row, ...set }
              : ({
                  control_plane_url: null,
                  pending_control_plane_url: null,
                  pending_status: null,
                  pending_error: null,
                  pending_applied_at: null,
                  created_at: new Date(),
                  updated_at: new Date(),
                  ...values,
                } as SystemSettingRow);
            return Promise.resolve([row]);
          },
        }),
      }),
    }),
  };

  return { db: db as unknown as Database, current: () => row };
};

const dnsCheck = (
  status: ControlPlaneDnsCheck['status'],
): ControlPlaneDnsCheck => ({
  hostname: 'cloud.example.com',
  expected_ip: '203.0.113.10',
  records: status === 'valid' ? ['203.0.113.10'] : [],
  aaaa_records: [],
  status,
  checked_at: '2026-11-04T10:00:00.000Z',
  message: null,
});

const createService = (
  initial?: Partial<SystemSettingRow>,
  dnsStatus: ControlPlaneDnsCheck['status'] = 'valid',
) => {
  const database = createDatabase(initial);
  const dns = { check: jest.fn().mockResolvedValue(dnsCheck(dnsStatus)) };
  const routing = {
    assertAvailable: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn().mockResolvedValue(undefined),
    unpublish: jest.fn().mockResolvedValue(undefined),
    probe: jest.fn().mockResolvedValue({ ok: false, error: 'TLS' }),
  };
  const service = new SystemService(
    database.db,
    dns as unknown as ControlPlaneDnsService,
    routing as unknown as ControlPlaneRoutingService,
  );
  return { service, dns, routing, current: database.current };
};

describe('SystemService', () => {
  afterEach(() => setControlPlaneOrigin(null));

  it('reports no URL before any change', async () => {
    const { service } = createService();
    await expect(service.getControlPlane()).resolves.toMatchObject({
      current_url: null,
      pending: null,
    });
  });

  it('saves a normalized pending URL and checks its DNS', async () => {
    const { service, dns } = createService(undefined, 'missing');
    const settings = await service.setPending({ url: 'Cloud.Example.com/' });

    expect(dns.check).toHaveBeenCalledWith('cloud.example.com');
    expect(settings.pending).toMatchObject({
      url: 'https://cloud.example.com',
      hostname: 'cloud.example.com',
      status: 'awaiting_dns',
      dns: { status: 'missing' },
    });
  });

  it('rejects an invalid URL', async () => {
    const { service } = createService();
    await expect(
      service.setPending({ url: 'https://cloud.example.com/path' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects the URL that is already applied', async () => {
    const { service } = createService({
      control_plane_url: 'https://cloud.example.com',
    });
    await expect(
      service.setPending({ url: 'cloud.example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to apply until DNS is valid', async () => {
    const { service, routing } = createService(
      {
        pending_control_plane_url: 'https://cloud.example.com',
        pending_status: 'awaiting_dns',
      },
      'mismatch',
    );

    await expect(service.apply()).rejects.toThrow(DNS_NOT_READY_MESSAGE);
    expect(routing.publish).not.toHaveBeenCalled();
  });

  it('publishes pending routes and starts provisioning', async () => {
    const { service, routing } = createService({
      pending_control_plane_url: 'https://cloud.example.com',
      pending_status: 'awaiting_dns',
    });

    const settings = await service.apply();

    expect(routing.assertAvailable).toHaveBeenCalled();
    expect(routing.publish).toHaveBeenCalledWith(
      'control-plane-pending',
      'cloud.example.com',
    );
    expect(settings.pending?.status).toBe('provisioning');
  });

  it('promotes the URL once HTTPS answers', async () => {
    const { service, routing, current } = createService({
      pending_control_plane_url: 'https://cloud.example.com',
      pending_status: 'provisioning',
      pending_applied_at: new Date(),
    });
    routing.probe.mockResolvedValue({ ok: true });

    const settings = await service.getControlPlane();

    expect(settings).toMatchObject({
      current_url: 'https://cloud.example.com',
      pending: null,
    });
    expect(routing.publish).toHaveBeenCalledWith(
      'control-plane',
      'cloud.example.com',
    );
    expect(routing.unpublish).toHaveBeenCalledWith('control-plane-pending');
    expect(current()?.pending_status).toBeNull();
    expect(getTrustedOrigins()).toContain('https://cloud.example.com');
  });

  it('keeps provisioning while the certificate is pending', async () => {
    const { service, routing } = createService({
      pending_control_plane_url: 'https://cloud.example.com',
      pending_status: 'provisioning',
      pending_applied_at: new Date(),
    });

    const settings = await service.getControlPlane();

    expect(settings.pending?.status).toBe('provisioning');
    expect(routing.unpublish).not.toHaveBeenCalled();
  });

  it('fails after the provisioning timeout', async () => {
    const { service, routing } = createService({
      pending_control_plane_url: 'https://cloud.example.com',
      pending_status: 'provisioning',
      pending_applied_at: new Date(Date.now() - PROVISIONING_TIMEOUT_MS - 1),
    });

    const settings = await service.getControlPlane();

    expect(settings.pending).toMatchObject({
      status: 'failed',
      error: PROVISIONING_TIMEOUT_MESSAGE,
    });
    expect(routing.unpublish).toHaveBeenCalledWith('control-plane-pending');
  });

  it('cancels a pending change and removes its routes', async () => {
    const { service, routing } = createService({
      control_plane_url: 'https://old.example.com',
      pending_control_plane_url: 'https://cloud.example.com',
      pending_status: 'failed',
    });

    const settings = await service.cancelPending();

    expect(routing.unpublish).toHaveBeenCalledWith('control-plane-pending');
    expect(settings).toMatchObject({
      current_url: 'https://old.example.com',
      pending: null,
    });
  });

  it('trusts the applied origin on startup', async () => {
    const { service } = createService({
      control_plane_url: 'https://cloud.example.com',
    });
    await service.onModuleInit();
    expect(getTrustedOrigins()).toContain('https://cloud.example.com');
  });
});
