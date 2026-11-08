import { createSign } from 'node:crypto';
import { BadGatewayException, Injectable } from '@nestjs/common';

export const GITHUB_URL = 'https://github.com';
const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REPOSITORY_PAGES = 10;
/** Refresh a cached installation token this long before it expires. */
const TOKEN_SKEW_MS = 60_000;

export interface GithubManifestConversion {
  id: number;
  slug: string;
  name: string;
  html_url: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
  owner: { login: string };
}

export interface GithubInstallationInfo {
  id: number;
  account: { login: string; type: string } | null;
  repository_selection: 'all' | 'selected';
  suspended_at: string | null;
}

export interface GithubRepositoryInfo {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
}

const base64url = (value: string | Buffer) =>
  Buffer.from(value).toString('base64url');

/** App JWT (RS256, 10 minutes) that authenticates as the App itself. */
export const signAppJwt = (appId: number, pem: string, now = Date.now()) => {
  const seconds = Math.floor(now / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    // Backdated 60s to tolerate clock drift, as GitHub recommends.
    JSON.stringify({
      iat: seconds - 60,
      exp: seconds + 9 * 60,
      iss: String(appId),
    }),
  )}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(pem);
  return `${unsigned}.${base64url(signature)}`;
};

@Injectable()
export class GithubClient {
  private readonly tokens = new Map<
    number,
    { token: string; expires: number }
  >();

  convertManifest(code: string): Promise<GithubManifestConversion> {
    return this.call(`/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
    });
  }

  getInstallation(
    appId: number,
    pem: string,
    installationId: number,
  ): Promise<GithubInstallationInfo> {
    return this.call(`/app/installations/${installationId}`, {
      token: signAppJwt(appId, pem),
    });
  }

  async listRepositories(
    appId: number,
    pem: string,
    installationId: number,
  ): Promise<GithubRepositoryInfo[]> {
    const token = await this.installationToken(appId, pem, installationId);
    const repositories: GithubRepositoryInfo[] = [];

    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const result = await this.call<{ repositories: GithubRepositoryInfo[] }>(
        `/installation/repositories?per_page=100&page=${page}`,
        { token },
      );
      repositories.push(...result.repositories);
      if (result.repositories.length < 100) break;
    }

    return repositories;
  }

  /** Installation access token for the repositories the install covers. */
  async installationToken(
    appId: number,
    pem: string,
    installationId: number,
  ): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expires - TOKEN_SKEW_MS > Date.now()) {
      return cached.token;
    }

    const created = await this.call<{ token: string; expires_at: string }>(
      `/app/installations/${installationId}/access_tokens`,
      { method: 'POST', token: signAppJwt(appId, pem) },
    );
    this.tokens.set(installationId, {
      token: created.token,
      expires: Date.parse(created.expires_at),
    });
    return created.token;
  }

  /**
   * A short-lived token that can only read one repository's contents, for a
   * build Job. Not cached: every build gets its own.
   */
  async repositoryReadToken(
    appId: number,
    pem: string,
    installationId: number,
    repository: string,
  ): Promise<string> {
    const created = await this.call<{ token: string }>(
      `/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        token: signAppJwt(appId, pem),
        body: {
          repositories: [repository.split('/')[1]],
          permissions: { contents: 'read' },
        },
      },
    );
    return created.token;
  }

  /** Branch names, in GitHub's order, up to 1000. */
  async listBranches(token: string, repository: string): Promise<string[]> {
    const names: string[] = [];

    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const result = await this.call<{ name: string }[]>(
        `/repos/${repository}/branches?per_page=100&page=${page}`,
        { token },
      );
      names.push(...result.map((branch) => branch.name));
      if (result.length < 100) break;
    }

    return names;
  }

  /** The commit a branch points at. */
  async branchHead(
    token: string,
    repository: string,
    branch: string,
  ): Promise<{ sha: string; message: string }> {
    const commit = await this.call<{
      sha: string;
      commit: { message: string };
    }>(`/repos/${repository}/commits/${encodeURIComponent(branch)}`, { token });
    return { sha: commit.sha, message: commit.commit.message };
  }

  private async call<T>(
    path: string,
    options: { method?: string; token?: string; body?: unknown } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${GITHUB_API}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'acceleratio',
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException(
        'GitHub is unreachable. Check the server has internet access.',
      );
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new BadGatewayException(
        `GitHub returned ${response.status}${body?.message ? `: ${body.message}` : ''}`,
      );
    }

    return (await response.json()) as T;
  }
}
