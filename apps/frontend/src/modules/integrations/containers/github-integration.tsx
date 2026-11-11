'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { sileo } from 'sileo';

import type {
  GithubApp,
  GithubIntegration as Integration,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { githubApi } from '@/api/github';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { SettingsSection } from '@/modules/settings/components/settings-section';
import { settingsSectionHref } from '@/modules/settings/sections';
import { getIntegration } from '../catalog';
import { GithubSetupSteps } from '../components/github-setup-steps';
import { IntegrationPageHeader } from '../components/integration-page-header';
import { GithubAppDeleteDialog } from './github-app-delete-dialog';
import { GithubAppDialog } from './github-app-dialog';
import { GithubAppRow } from './github-app-row';

export const GITHUB_PAGE_HREF = '/settings/integrations/github';

const RESULT_TITLES: Record<string, string> = {
  created: 'GitHub App created. Install it to pick repositories.',
  installed: 'GitHub App installed',
};

/** Shows the outcome GitHub's redirect left in the URL, then clears it. */
const useRedirectResult = (onDone: () => void) => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('github');
    if (!result) return;

    if (result === 'error') {
      sileo.error({
        title: 'GitHub setup failed',
        description: params.get('github_error') ?? undefined,
      });
    } else if (RESULT_TITLES[result]) {
      sileo.success({ title: RESULT_TITLES[result] });
    }
    window.history.replaceState(null, '', GITHUB_PAGE_HREF);
    onDone();
  }, [onDone]);
};

const setupStep = (apps: GithubApp[]): 1 | 2 | 3 | 4 => {
  if (apps.length === 0) return 1;
  if (!apps.some((app) => app.installations.length > 0)) return 2;
  return 4;
};

export const GithubIntegration = () => {
  const integration = getIntegration('github');
  const [data, setData] = useState<Integration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<GithubApp | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const load = useCallback(() => {
    githubApi
      .get()
      .then(setData)
      .catch((loadError) => setError(getApiErrorMessage(loadError)));
  }, []);

  useEffect(load, [load]);
  useRedirectResult(load);

  const install = async (app: GithubApp) => {
    setInstallingId(app.id);
    try {
      const { url } = await githubApi.installUrl(
        app.id,
        window.location.origin,
      );
      window.location.assign(url);
    } catch (installError) {
      sileo.error({
        title: 'Could not start the installation',
        description: getApiErrorMessage(installError),
      });
      setInstallingId(null);
    }
  };

  const step = data ? setupStep(data.apps) : 1;

  return (
    <div className="flex flex-col gap-6">
      <IntegrationPageHeader
        integration={integration}
        action={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            Add GitHub App
          </Button>
        }
      />

      {data && step < 4 ? <GithubSetupSteps step={step} /> : null}

      {data && !data.webhooks_active ? (
        <p className="panel-lit rounded-lg px-4 py-3 text-sm text-fg-secondary">
          This server has no HTTPS address, so GitHub cannot send events back
          (for example when an App is uninstalled). Connecting and listing
          repositories still work.{' '}
          <a
            href={settingsSectionHref('system')}
            className="text-brand-fg underline-offset-4 hover:underline"
          >
            Set the control plane URL
          </a>{' '}
          before adding an App to turn events on.
        </p>
      ) : null}

      <SettingsSection
        id="github-apps"
        title="GitHub Apps"
        description="An App installs only on the account that owns it, so connect each organization with its own App. Access can then be limited per App."
      >
        {error ? (
          <p role="alert" className="text-sm text-status-danger">
            {error}
          </p>
        ) : !data ? (
          <Skeleton className="h-16 w-full" />
        ) : data.apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No GitHub Apps yet. Add one to let Acceleratio read your
            repositories.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.apps.map((app) => (
              <GithubAppRow
                key={app.id}
                app={app}
                installing={installingId === app.id}
                onInstall={() => void install(app)}
                onDelete={() => setDeleting(app)}
              />
            ))}
          </ul>
        )}
      </SettingsSection>

      <GithubAppDialog open={createOpen} onOpenChange={setCreateOpen} />
      <GithubAppDeleteDialog
        app={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={load}
      />
    </div>
  );
};
