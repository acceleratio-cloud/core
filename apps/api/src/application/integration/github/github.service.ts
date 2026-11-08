import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateGithubAppPayload,
  GithubApp,
  GithubAppManifestRequest,
  GithubInstallUrl,
  GithubIntegration,
  GithubRepository,
} from '@acceleratio/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { normalizeName } from '@/common/validation';
import {
  decryptSecret,
  encryptSecret,
  signState,
  verifyState,
} from '@/common/secret-box';
import { SystemService } from '@/application/system/system.service';
import { isTrustedOrigin } from '@/vendor/auth/trusted-origins';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  GITHUB_URL,
  GithubClient,
  type GithubInstallationInfo,
} from '@/vendor/github/github.client';
import { githubApp, type GithubAppRow } from './schemas/github-app.schema';
import {
  githubInstallation,
  type GithubInstallationRow,
} from './schemas/github-installation.schema';

export const INVALID_STATE_MESSAGE =
  'The request expired or was not started from this console. Start again.';
export const INVALID_RETURN_URL_MESSAGE = 'Unrecognized console address';

const isHttps = (url: string) => url.startsWith('https://');

const STATE_TTL_MS = 10 * 60 * 1000;
/** Console page GitHub's redirects return to. */
export const RETURN_PATH = '/settings/integrations/github';
const ORGANIZATION_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
/** GitHub rejects App names longer than this. */
const APP_NAME_MAX_LENGTH = 34;

type ManifestState = { t: 'manifest'; id: string; user: string; ret: string };
type InstallState = { t: 'install'; app: string; ret: string };

export interface InstallationPayload {
  action?: string;
  repository_selection?: 'all' | 'selected';
  installation?: GithubInstallationInfo;
}

@Injectable()
export class GithubService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubClient,
    private readonly system: SystemService,
  ) {}

  async list(): Promise<GithubIntegration> {
    const base = await this.apiUrl();
    const [apps, installations] = await Promise.all([
      this.db.select().from(githubApp).orderBy(asc(githubApp.created_at)),
      this.db.select().from(githubInstallation),
    ]);

    return {
      apps: apps.map((app) =>
        this.toApp(
          app,
          installations.filter((item) => item.app_id === app.id),
        ),
      ),
      api_url: base,
      webhooks_active: isHttps(base),
    };
  }

  /** The manifest the console posts to GitHub; nothing is stored yet. */
  async createManifest(
    payload: CreateGithubAppPayload,
    userId: string,
  ): Promise<GithubAppManifestRequest> {
    const name = normalizeName(payload.name);
    if (name.length > APP_NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `GitHub limits App names to ${APP_NAME_MAX_LENGTH} characters`,
      );
    }
    const organization = payload.organization?.trim();
    if (organization && !ORGANIZATION_PATTERN.test(organization)) {
      throw new BadRequestException('Enter a valid GitHub organization name');
    }
    const ret = this.parseReturnUrl(payload.return_url);
    const base = await this.apiUrl();

    const id = randomUUID();
    const state = signState(
      { t: 'manifest', id, user: userId, ret } satisfies ManifestState,
      STATE_TTL_MS,
    );
    const manifest = {
      name,
      url: ret,
      hook_attributes: {
        url: `${base}/integrations/github/apps/${id}/webhook`,
        // GitHub can only deliver to HTTPS; redirects below go through the
        // user's browser and work on any address.
        active: isHttps(base),
      },
      redirect_url: `${base}/integrations/github/manifest/callback`,
      setup_url: `${base}/integrations/github/apps/${id}/installed`,
      setup_on_update: true,
      public: false,
      default_permissions: { contents: 'read', metadata: 'read' },
      default_events: [],
    };

    return {
      post_url: `${GITHUB_URL}/${organization ? `organizations/${organization}/` : ''}settings/apps/new?state=${state}`,
      manifest: JSON.stringify(manifest),
    };
  }

  /** Finishes the manifest flow; returns the console URL to send the browser to. */
  async completeManifest(code: string, state: string): Promise<string> {
    const claims = this.readState<ManifestState>(state, 'manifest');
    const converted = await this.github.convertManifest(code);

    await this.db.insert(githubApp).values({
      id: claims.id,
      github_app_id: converted.id,
      name: converted.name,
      slug: converted.slug,
      owner_login: converted.owner.login,
      html_url: converted.html_url,
      client_id: converted.client_id,
      client_secret_enc: encryptSecret(converted.client_secret),
      webhook_secret_enc: encryptSecret(converted.webhook_secret),
      private_key_enc: encryptSecret(converted.pem),
      created_by: claims.user,
    });

    return this.returnUrl(claims.ret, 'created');
  }

  async installUrl(id: string, returnUrl: string): Promise<GithubInstallUrl> {
    const app = await this.requireApp(id);
    const state = signState(
      {
        t: 'install',
        app: id,
        ret: this.parseReturnUrl(returnUrl),
      } satisfies InstallState,
      STATE_TTL_MS,
    );

    return {
      url: `${GITHUB_URL}/apps/${app.slug}/installations/new?state=${state}`,
    };
  }

  /** Setup URL target: records the installation GitHub just created. */
  async completeInstall(
    id: string,
    installationId: number,
    state: string,
  ): Promise<string> {
    const claims = this.readState<InstallState>(state, 'install');
    if (claims.app !== id) {
      throw new BadRequestException(INVALID_STATE_MESSAGE);
    }

    const app = await this.requireApp(id);
    // Asking GitHub as the App proves the installation belongs to it.
    const info = await this.github.getInstallation(
      app.github_app_id,
      decryptSecret(app.private_key_enc),
      installationId,
    );
    await this.saveInstallation(app.id, info);

    return this.returnUrl(claims.ret, 'installed');
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .delete(githubApp)
      .where(eq(githubApp.id, id))
      .returning({ id: githubApp.id });
    if (deleted.length === 0) {
      throw new NotFoundException('GitHub App not found');
    }
  }

  async repositories(id: string): Promise<GithubRepository[]> {
    const app = await this.requireApp(id);
    const installations = await this.db
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.app_id, id));
    const pem = decryptSecret(app.private_key_enc);

    const groups = await Promise.all(
      installations
        .filter((item) => !item.suspended)
        .map(async (item) =>
          (
            await this.github.listRepositories(
              app.github_app_id,
              pem,
              item.installation_id,
            )
          ).map((repo) => ({
            id: repo.id,
            full_name: repo.full_name,
            private: repo.private,
            default_branch: repo.default_branch,
            installation_id: item.installation_id,
          })),
        ),
    );

    return groups.flat();
  }

  /** Keeps installations in step with changes made on github.com. */
  async handleWebhook(
    id: string,
    event: string | undefined,
    payload: InstallationPayload,
  ): Promise<void> {
    const info = payload.installation;
    if (!info) return;

    if (event === 'installation') {
      if (payload.action === 'deleted') {
        await this.db
          .delete(githubInstallation)
          .where(eq(githubInstallation.installation_id, info.id));
      } else if (
        payload.action === 'created' ||
        payload.action === 'suspend' ||
        payload.action === 'unsuspend'
      ) {
        await this.saveInstallation(id, info);
      }
    } else if (event === 'installation_repositories') {
      await this.db
        .update(githubInstallation)
        .set({
          repository_selection:
            payload.repository_selection ?? info.repository_selection,
        })
        .where(eq(githubInstallation.installation_id, info.id));
    }
  }

  /** Webhook secret of one App, for checking a delivery's signature. */
  async webhookSecret(id: string): Promise<string> {
    return decryptSecret((await this.requireApp(id)).webhook_secret_enc);
  }

  /**
   * Address the browser (and, when HTTPS, GitHub) reaches the API on: the dev
   * tunnel, else the control plane URL, else the installer's own address.
   */
  async apiUrl(): Promise<string> {
    const override = process.env.GITHUB_CALLBACK_BASE_URL?.trim();
    if (override) return override.replace(/\/+$/, '');

    const { current_url } = await this.system.getControlPlane();
    if (current_url) return `${current_url}/api`;

    return (process.env.BETTER_AUTH_URL ?? 'http://localhost:8080').replace(
      /\/+$/,
      '',
    );
  }

  returnUrl(
    origin: string,
    result: 'created' | 'installed' | 'error',
    message?: string,
  ) {
    const params = new URLSearchParams({ github: result });
    if (message) params.set('github_error', message);
    return `${origin}${RETURN_PATH}?${params}`;
  }

  /** Console origin recorded in a state token, for redirecting after a failure. */
  returnOriginOf(state: string): string | null {
    const claims = verifyState<{ ret?: string }>(state);
    return claims?.ret && isTrustedOrigin(claims.ret) ? claims.ret : null;
  }

  private parseReturnUrl(value: unknown): string {
    let origin: string;
    try {
      origin = new URL(String(value)).origin;
    } catch {
      throw new BadRequestException(INVALID_RETURN_URL_MESSAGE);
    }
    if (!isTrustedOrigin(origin)) {
      throw new BadRequestException(INVALID_RETURN_URL_MESSAGE);
    }
    return origin;
  }

  private readState<T extends { t: string }>(state: string, type: T['t']): T {
    const claims = verifyState<T>(state);
    if (!claims || claims.t !== type) {
      throw new BadRequestException(INVALID_STATE_MESSAGE);
    }
    return claims;
  }

  private async requireApp(id: string): Promise<GithubAppRow> {
    const [row] = await this.db
      .select()
      .from(githubApp)
      .where(eq(githubApp.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('GitHub App not found');
    }
    return row;
  }

  private async saveInstallation(
    appId: string,
    info: GithubInstallationInfo,
  ): Promise<void> {
    const details = {
      account_login: info.account?.login ?? 'unknown',
      account_type: info.account?.type ?? 'User',
      repository_selection: info.repository_selection,
      suspended: info.suspended_at !== null,
    };
    await this.db
      .insert(githubInstallation)
      .values({ app_id: appId, installation_id: info.id, ...details })
      .onConflictDoUpdate({
        target: githubInstallation.installation_id,
        // Qualified: the unqualified `$onUpdate` column is ambiguous here.
        set: {
          ...details,
          updated_at: sql`greatest(now()::timestamp, ${githubInstallation.updated_at} + interval '1 microsecond')`,
        },
      });
  }

  private toApp(
    row: GithubAppRow,
    installations: GithubInstallationRow[],
  ): GithubApp {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      owner_login: row.owner_login,
      html_url: row.html_url,
      installations: installations.map((item) => ({
        id: item.id,
        installation_id: item.installation_id,
        account_login: item.account_login,
        account_type: item.account_type,
        repository_selection: item.repository_selection as 'all' | 'selected',
        suspended: item.suspended,
      })),
      created_at: row.created_at.toISOString(),
    };
  }
}
