import type { GithubInstallation } from '@acceleratio/shared';

/** The installation's settings page on github.com: repositories, suspend, uninstall. */
export const installationSettingsUrl = (
  installation: Pick<
    GithubInstallation,
    'installation_id' | 'account_login' | 'account_type'
  >,
): string =>
  installation.account_type === 'Organization'
    ? `https://github.com/organizations/${encodeURIComponent(installation.account_login)}/settings/installations/${installation.installation_id}`
    : `https://github.com/settings/installations/${installation.installation_id}`;
