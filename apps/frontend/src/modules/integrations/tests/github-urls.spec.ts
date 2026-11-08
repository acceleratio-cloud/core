import { describe, expect, it } from 'bun:test';

import { installationSettingsUrl } from '../utils/github-urls';

describe('installationSettingsUrl', () => {
  it('points a personal account at its own settings', () => {
    expect(
      installationSettingsUrl({
        installation_id: 42,
        account_login: 'octo',
        account_type: 'User',
      }),
    ).toBe('https://github.com/settings/installations/42');
  });

  it('points an organization at its organization settings', () => {
    expect(
      installationSettingsUrl({
        installation_id: 42,
        account_login: 'acme-inc',
        account_type: 'Organization',
      }),
    ).toBe(
      'https://github.com/organizations/acme-inc/settings/installations/42',
    );
  });
});
