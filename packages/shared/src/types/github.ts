export interface GithubInstallation {
  id: string;
  /** GitHub's numeric installation id. */
  installation_id: number;
  account_login: string;
  account_type: string;
  repository_selection: 'all' | 'selected';
  suspended: boolean;
}

/** A GitHub App created from the console. Secrets are never returned. */
export interface GithubApp {
  id: string;
  name: string;
  slug: string;
  owner_login: string;
  /** Page on github.com where the App is managed. */
  html_url: string;
  /** Page on github.com that installs the App. */
  installations: GithubInstallation[];
  created_at: string;
}

export interface GithubIntegration {
  apps: GithubApp[];
  /** API address GitHub's redirects and webhooks use. */
  api_url: string;
  /**
   * False when that address is not HTTPS: GitHub cannot deliver webhooks, but
   * creating the App, installing it and listing repositories still work.
   */
  webhooks_active: boolean;
}

export interface CreateGithubAppPayload {
  name: string;
  /** Organization that owns the App; empty for the signed-in GitHub account. */
  organization?: string;
  /** Console origin GitHub sends the browser back to. */
  return_url: string;
}

/** What the console posts to GitHub to create the App in one confirmation. */
export interface GithubAppManifestRequest {
  /** github.com URL the console form posts the manifest to. */
  post_url: string;
  /** JSON manifest, sent as the `manifest` form field. */
  manifest: string;
}

export interface GithubInstallUrl {
  url: string;
}

export interface GithubRepository {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  installation_id: number;
}
