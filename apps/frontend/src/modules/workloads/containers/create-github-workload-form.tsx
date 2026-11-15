'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Globe, Lock } from 'lucide-react';

import type {
  GithubApp,
  GithubRepository,
  Workload,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { githubApi } from '@/api/github';
import { workloadsApi } from '@/api/workloads';
import {
  GeneratedNameInput,
  generateName,
} from '@/shared/components/generated-name-input';
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
import { githubRepositoryName } from '../utils/github-repository-name';
import { GithubBranchSelect } from './github-branch-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';

type RepositoryTab = 'private' | 'public';
type PublicRepository = Omit<GithubRepository, 'installation_id'>;

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
  const [tab, setTab] = useState<RepositoryTab>('private');
  const [address, setAddress] = useState('');
  const [addressLeft, setAddressLeft] = useState(false);
  const publicName = githubRepositoryName(address);
  const [found, setFound] = useState<{
    name: string;
    repository: PublicRepository | null;
    error: string | null;
  } | null>(null);
  // The lookup of the name in the field; null while it runs.
  const lookup = found?.name === publicName ? found : null;
  const publicRepository = lookup?.repository ?? null;
  const [name, setName] = useState(generateName);
  // Each tab keeps the branch chosen on it.
  const [branches, setBranches] = useState<Record<RepositoryTab, string>>({
    private: '',
    public: '',
  });
  const branch = branches[tab];
  const setBranch = (next: string) =>
    setBranches((current) => ({ ...current, [tab]: next }));
  // Loading the App's repositories; shown on the Private tab only.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A public repository is read without an App.
  const sourceAppId = tab === 'private' ? appId : undefined;
  const selected = tab === 'private' ? repository : publicRepository;
  const addressError =
    addressLeft && address.trim() && !publicName
      ? 'Enter a repository as owner/name or its github.com address.'
      : null;
  const shownError =
    error ??
    (tab === 'private' ? loadError : (addressError ?? lookup?.error ?? null));

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
      .catch((failure) => {
        setApps([]);
        setLoadError(getApiErrorMessage(failure));
      });
  }, []);

  useEffect(() => {
    if (!appId) return;

    let cancelled = false;

    githubApi
      .repositories(appId)
      .then((list) => !cancelled && setLoaded({ appId, list }))
      .catch((failure) => {
        if (cancelled) return;
        setLoaded({ appId, list: [] });
        setLoadError(getApiErrorMessage(failure));
      });

    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    if (!publicName) return;

    let cancelled = false;
    // Looked up once typing pauses, not on every key.
    const timer = setTimeout(() => {
      githubApi
        .publicRepository(publicName)
        .then((next) => {
          if (cancelled) return;
          setFound({ name: publicName, repository: next, error: null });
          setBranches((current) => ({
            ...current,
            public: next.default_branch,
          }));
        })
        .catch((failure) => {
          if (cancelled) return;
          setFound({
            name: publicName,
            repository: null,
            error: getApiErrorMessage(failure),
          });
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [publicName]);

  const switchTab = (next: RepositoryTab) => {
    setTab(next);
    setError(null);
  };

  const pick = (fullName: string) => {
    const next = repositories?.find((item) => item.full_name === fullName);

    if (!next) return;
    setPicked(next);
    setBranch(next.default_branch);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selected || sourceAppId === null) {
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
            github_app_id: sourceAppId,
            repository: selected.full_name,
            branch: branch.trim() || selected.default_branch,
          },
        }),
      );
    } catch (createError) {
      setError(getApiErrorMessage(createError));
      setSubmitting(false);
    }
  };

  const noApp = apps !== null && apps.length === 0;
  const blocked = tab === 'private' && noApp;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create GitHub service</DialogTitle>
        <DialogDescription>
          Connect a repository branch. Each deploy builds the Dockerfile at its
          root, or detects the stack with Railpack when there is none.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} noValidate>
        <Tabs
          value={tab}
          onValueChange={(next) => switchTab(next as RepositoryTab)}
          className="mt-4"
        >
          <TabsList>
            <TabsTrigger value="private">
              <Lock aria-hidden="true" strokeWidth={1.75} />
              Private repository
            </TabsTrigger>
            <TabsTrigger value="public">
              <Globe aria-hidden="true" strokeWidth={1.75} />
              Public repository
            </TabsTrigger>
          </TabsList>

          <FieldGroup className="mt-5">
            <TabsContent value="private" className="flex flex-col gap-5">
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
                    <FieldLabel htmlFor="github-repository">
                      Repository
                    </FieldLabel>
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
                </>
              )}
            </TabsContent>

            <TabsContent value="public" className="flex flex-col gap-5">
              <Field>
                <FieldLabel htmlFor="github-public-repository">
                  Repository
                </FieldLabel>
                <Input
                  id="github-public-repository"
                  value={address}
                  aria-invalid={
                    addressError || lookup?.error ? true : undefined
                  }
                  onBlur={() => setAddressLeft(true)}
                  placeholder="owner/name or https://github.com/owner/name"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  onChange={(event) => {
                    setAddress(event.target.value);
                    setAddressLeft(false);
                    setError(null);
                  }}
                />
                <FieldDescription>
                  No GitHub App needed. Pushes do not deploy it; Deploy builds
                  the branch&apos;s latest commit.
                </FieldDescription>
              </Field>
            </TabsContent>

            {blocked ? null : (
              <>
                <Field>
                  <FieldLabel htmlFor="github-branch">Branch</FieldLabel>
                  {selected ? (
                    <GithubBranchSelect
                      id="github-branch"
                      appId={sourceAppId ?? undefined}
                      repository={selected.full_name}
                      value={branch}
                      onChange={setBranch}
                    />
                  ) : (
                    <Input
                      id="github-branch"
                      disabled
                      placeholder={
                        tab === 'public' && publicName && !lookup
                          ? 'Looking up the repository…'
                          : 'Choose a repository first'
                      }
                    />
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="github-name">Name</FieldLabel>
                  <GeneratedNameInput
                    id="github-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onGenerate={setName}
                  />
                </Field>
              </>
            )}

            <FieldError>{shownError}</FieldError>
          </FieldGroup>
        </Tabs>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back
          </Button>
          <Button type="submit" disabled={submitting || blocked || !selected}>
            {submitting ? 'Creating...' : 'Create service'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};
