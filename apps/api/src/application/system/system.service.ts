import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  ControlPlaneDnsCheck,
  ControlPlaneSettings,
  SetControlPlaneUrlPayload,
} from '@acceleratio/shared';
import { eq } from 'drizzle-orm';
import {
  getConfiguredOrigins,
  setControlPlaneOrigin,
} from '@/vendor/auth/trusted-origins';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { ControlPlaneDnsService } from './control-plane-dns.service';
import { ControlPlaneRoutingService } from './control-plane-routing.service';
import { normalizeControlPlaneUrl, toOrigin } from './control-plane-url';
import { ACTIVE_ROUTE, PENDING_ROUTE } from './control-plane.manifests';
import {
  systemSetting,
  type SystemSettingRow,
} from './schemas/system-setting.schema';

const SETTINGS_ID = 1;
/** How long to wait for the certificate before reporting a failure. */
export const PROVISIONING_TIMEOUT_MS = 10 * 60 * 1000;

export const NO_PENDING_MESSAGE = 'No control plane URL change is in progress';
export const SAME_URL_MESSAGE = 'This is already the control plane URL';
export const DNS_NOT_READY_MESSAGE =
  'The DNS record does not point to this server yet';
export const ALREADY_APPLYING_MESSAGE =
  'The URL change is already being applied';
export const PROVISIONING_TIMEOUT_MESSAGE =
  'The HTTPS certificate was not issued within 10 minutes. Check that ports 80 and 443 are open and the A record is correct, then try again.';

type SettingsPatch = Partial<
  Pick<
    SystemSettingRow,
    | 'control_plane_url'
    | 'pending_control_plane_url'
    | 'pending_status'
    | 'pending_error'
    | 'pending_applied_at'
  >
>;

const CLEARED_PENDING: SettingsPatch = {
  pending_control_plane_url: null,
  pending_status: null,
  pending_error: null,
  pending_applied_at: null,
};

/**
 * Moves the console to a new root URL in three steps: save the URL and wait
 * for its A record, publish routes and wait for the HTTPS certificate, then
 * promote it to the applied URL. The installer's IP:NodePort address keeps
 * working throughout.
 */
@Injectable()
export class SystemService implements OnModuleInit {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly dns: ControlPlaneDnsService,
    private readonly routing: ControlPlaneRoutingService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const row = await this.read();
      setControlPlaneOrigin(
        row?.control_plane_url ? toOrigin(row.control_plane_url) : null,
      );
    } catch (error) {
      // The API must start even before migrations ran (local development).
      this.logger.warn(
        `Could not load the control plane URL: ${String(error)}`,
      );
    }
  }

  async getControlPlane(): Promise<ControlPlaneSettings> {
    let row = await this.read();

    if (row?.pending_status === 'provisioning') {
      row = await this.advanceProvisioning(row);
    }

    return this.toSettings(row, null);
  }

  async setPending(
    payload: SetControlPlaneUrlPayload,
  ): Promise<ControlPlaneSettings> {
    const { url, hostname } = normalizeControlPlaneUrl(payload?.url);
    const current = await this.read();

    if (current?.pending_status === 'provisioning') {
      throw new ConflictException(ALREADY_APPLYING_MESSAGE);
    }
    if (current?.control_plane_url === url) {
      throw new ConflictException(SAME_URL_MESSAGE);
    }

    const row = await this.write({
      pending_control_plane_url: url,
      pending_status: 'awaiting_dns',
      pending_error: null,
      pending_applied_at: null,
    });

    return this.toSettings(row, await this.dns.check(hostname));
  }

  async checkDns(): Promise<ControlPlaneDnsCheck> {
    const row = await this.requirePending();
    return this.dns.check(this.pendingHostname(row));
  }

  async cancelPending(): Promise<ControlPlaneSettings> {
    const row = await this.read();

    if (row?.pending_control_plane_url) {
      await this.routing.unpublish(PENDING_ROUTE);
    }

    return this.toSettings(await this.write(CLEARED_PENDING), null);
  }

  async apply(): Promise<ControlPlaneSettings> {
    const row = await this.requirePending();
    if (row.pending_status === 'provisioning') {
      throw new ConflictException(ALREADY_APPLYING_MESSAGE);
    }

    const hostname = this.pendingHostname(row);
    const dns = await this.dns.check(hostname);
    if (dns.status !== 'valid') {
      throw new ConflictException(DNS_NOT_READY_MESSAGE);
    }

    await this.routing.assertAvailable();
    await this.routing.publish(PENDING_ROUTE, hostname);

    const updated = await this.write({
      pending_status: 'provisioning',
      pending_error: null,
      pending_applied_at: new Date(),
    });

    return this.toSettings(updated, dns);
  }

  /**
   * Checks whether the pending host serves HTTPS yet. On success the pending
   * routes become the active ones and the URL is promoted; after the timeout
   * the change is marked failed and its routes are removed.
   */
  private async advanceProvisioning(
    row: SystemSettingRow,
  ): Promise<SystemSettingRow> {
    const hostname = this.pendingHostname(row);
    const probe = await this.routing.probe(hostname);

    if (probe.ok) {
      const url = row.pending_control_plane_url as string;
      await this.routing.publish(ACTIVE_ROUTE, hostname);
      await this.routing.unpublish(PENDING_ROUTE);
      const promoted = await this.write({
        ...CLEARED_PENDING,
        control_plane_url: url,
      });
      setControlPlaneOrigin(toOrigin(url));
      this.logger.log(`Control plane URL changed to ${url}`);
      return promoted;
    }

    const startedAt = row.pending_applied_at?.getTime() ?? Date.now();
    if (Date.now() - startedAt < PROVISIONING_TIMEOUT_MS) {
      return row;
    }

    this.logger.warn(
      `Control plane URL ${row.pending_control_plane_url} did not come up: ${probe.error ?? 'unknown error'}`,
    );
    await this.routing.unpublish(PENDING_ROUTE);
    return this.write({
      pending_status: 'failed',
      pending_error: PROVISIONING_TIMEOUT_MESSAGE,
      pending_applied_at: null,
    });
  }

  private async requirePending(): Promise<SystemSettingRow> {
    const row = await this.read();
    if (!row?.pending_control_plane_url) {
      throw new ConflictException(NO_PENDING_MESSAGE);
    }
    return row;
  }

  private pendingHostname(row: SystemSettingRow): string {
    return new URL(row.pending_control_plane_url as string).hostname;
  }

  private async read(): Promise<SystemSettingRow | undefined> {
    const [row] = await this.db
      .select()
      .from(systemSetting)
      .where(eq(systemSetting.id, SETTINGS_ID))
      .limit(1);
    return row;
  }

  private async write(patch: SettingsPatch): Promise<SystemSettingRow> {
    const [row] = await this.db
      .insert(systemSetting)
      .values({ id: SETTINGS_ID, ...patch })
      .onConflictDoUpdate({ target: systemSetting.id, set: patch })
      .returning();
    return row;
  }

  private toSettings(
    row: SystemSettingRow | undefined,
    dns: ControlPlaneDnsCheck | null,
  ): ControlPlaneSettings {
    const pendingUrl = row?.pending_control_plane_url;

    return {
      current_url: row?.control_plane_url ?? null,
      fallback_url: getConfiguredOrigins()[0] ?? null,
      pending:
        pendingUrl && row?.pending_status
          ? {
              url: pendingUrl,
              hostname: new URL(pendingUrl).hostname,
              status: row.pending_status,
              error: row.pending_error,
              dns,
            }
          : null,
    };
  }
}
