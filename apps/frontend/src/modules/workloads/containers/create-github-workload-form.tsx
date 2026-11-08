'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import type {
  GithubApp,
  GithubRepository,
  Workload,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { githubApi } from '@/api/github';
import { workloadsApi } from '@/api/workloads';
import { Button } from '@/shared/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

export const CreateGithubWorkloadForm = ({
  projectId,
  onCreated,
  onBack,
}: {
  projectId: string;
  onCreated: (workload: Workload) => void;
  onBack: () => void;
}) => {
  const [apps, setApps] = useState<GithubApp[] | null>(null);
  const [appId, setAppId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{
    appId: string;
    list: GithubRepository[];
  } | null>(null);
  const [picked, setPicked] = useState<GithubRepository | null>(null);
  // Repositories of the selected App only; null while they load.
  const repositories = loaded?.appId === appId ? loaded.list : null;
  const repository = picked && repositories?.includes(picked) ? picked : null;
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    githubApi
      .get()
      .then((integration) => {
        const ready = integration.apps.filter(
          (app) => app.installations.length > 0,
        );

        setApps(ready);
        setAppId(ready[0]?.id ?? null);
      })
      .catch((loadError) => {
        setApps([]);
        setError(getApiErrorMessage(loadError));
      });
  }, []);

  useEffect(() => {
    if (!appId) return;

    let cancelled = false;

    githubApi
      .repositories(appId)
      .then((list) => !cancelled && setLoaded({ appId, list }))
      .catch((loadError) => {
        if (cancelled) return;
        setLoaded({ appId, list: [] });
        setError(getApiErrorMessage(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [appId]);

  const pick = (fullName: string) => {
    const next = repositories?.find((item) => item.full_name === fullName);

    if (!next) return;
    setPicked(next);
    setBranch(next.default_branch);
    setName((current) => current || next.full_name.split('/')[1]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!appId || !repository) {
      setError('Choose a repository.');
      return;
    }
    if (!name.trim()) {
      setError('Give the service a name.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      onCreated(
        await workloadsApi.create(projectId, {
          name: name.trim(),
          type: 'github',
          config: {
            github_app_id: appId,
            repository: repository.full_name,
            branch: branch.trim() || repository.default_branch,
          },
        }),
      );
    } catch (createError) {
      setError(getApiErrorMessage(createError));
      setSubmitting(false);
    }
  };

  const noApp = apps !== null && apps.length === 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create GitHub service</DialogTitle>
        <DialogDescription>
          Connect a repository branch. Deploying from it is not available yet.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} noValidate>
        <FieldGroup className="mt-5">
          {noApp ? (
            <FieldDescription>
              No installed GitHub App yet. Set one up in{' '}
              <a
                href="/settings/integrations/github"
                className="underline underline-offset-2"
              >
                Settings → Integrations
              </a>
              .
            </FieldDescription>
          ) : (
            <>
              {apps !== null && apps.length > 1 ? (
                <Field>
                  <FieldLabel htmlFor="github-app">GitHub App</FieldLabel>
                  <Select
                    value={appId}
                    items={apps.map((app) => ({
                      value: app.id,
                      label: app.name,
                    }))}
                    onValueChange={(next) =>
                      typeof next === 'string' && setAppId(next)
                    }
                  >
                    <SelectTrigger id="github-app">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {apps.map((app) => (
                        <SelectItem key={app.id} value={app.id}>
                          {app.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              <Field>
                <FieldLabel htmlFor="github-repository">Repository</FieldLabel>
                <Select
                  value={repository?.full_name ?? null}
                  items={(repositories ?? []).map((item) => ({
                    value: item.full_name,
                    label: item.full_name,
                  }))}
                  disabled={repositories === null}
                  onValueChange={(next) =>
                    typeof next === 'string' && pick(next)
                  }
                >
                  <SelectTrigger id="github-repository">
                    <SelectValue
                      placeholder={
                        repositories === null
                          ? 'Loading repositories…'
                          : 'Choose a repository'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(repositories ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.full_name}>
                        {item.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="github-branch">Branch</FieldLabel>
                <Input
                  id="github-branch"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="github-name">Name</FieldLabel>
                <Input
                  id="github-name"
                  autoComplete="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            </>
          )}

          <FieldError>{error}</FieldError>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back
          </Button>
          <Button type="submit" disabled={submitting || noApp || !repository}>
            {submitting ? 'Creating...' : 'Create service'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};
