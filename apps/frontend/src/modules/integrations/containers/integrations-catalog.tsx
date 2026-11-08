'use client';

import { useEffect, useState } from 'react';

import { githubApi } from '@/api/github';
import { SettingsSection } from '@/modules/settings/components/settings-section';
import { INTEGRATIONS } from '../catalog';
import { IntegrationCard } from '../components/integration-card';

const plural = (count: number, one: string, other: string) =>
  `${count} ${count === 1 ? one : other}`;

/** One card per provider; each opens its own page. */
export const IntegrationsCatalog = () => {
  const [githubStatus, setGithubStatus] = useState<string | null>(null);

  useEffect(() => {
    githubApi
      .get()
      .then(({ apps }) => {
        if (apps.length === 0) return;
        const installs = apps.reduce(
          (sum, app) => sum + app.installations.length,
          0,
        );
        setGithubStatus(
          `${plural(apps.length, 'App', 'Apps')} · ${plural(installs, 'installation', 'installations')}`,
        );
      })
      // The card still links through; the status line only says "Not connected".
      .catch(() => undefined);
  }, []);

  return (
    <SettingsSection
      id="integrations"
      title="Integrations"
      description="Connect Acceleratio to the services your team already uses."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {INTEGRATIONS.map((integration) => (
          <li key={integration.id}>
            <IntegrationCard
              integration={integration}
              status={integration.id === 'github' ? githubStatus : null}
            />
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
};
