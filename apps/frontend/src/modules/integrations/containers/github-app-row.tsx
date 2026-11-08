'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink, Lock, Trash2 } from 'lucide-react';

import type { GithubApp, GithubRepository } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { githubApi } from '@/api/github';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { installationSettingsUrl } from '../utils/github-urls';

type GithubAppRowProps = {
  app: GithubApp;
  installing: boolean;
  onInstall: () => void;
  onDelete: () => void;
};

type Repositories =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; items: GithubRepository[] };

export const GithubAppRow = ({
  app,
  installing,
  onInstall,
  onDelete,
}: GithubAppRowProps) => {
  const [open, setOpen] = useState(false);
  const [repositories, setRepositories] = useState<Repositories>({
    state: 'idle',
  });
  const installed = app.installations.length > 0;

  const toggleRepositories = async () => {
    const next = !open;
    setOpen(next);
    if (!next || repositories.state === 'ready') return;

    setRepositories({ state: 'loading' });
    try {
      setRepositories({
        state: 'ready',
        items: await githubApi.repositories(app.id),
      });
    } catch (error) {
      setRepositories({ state: 'error', message: getApiErrorMessage(error) });
    }
  };

  return (
    <li className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{app.name}</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Owned by {app.owner_login}
            {' · '}
            <a
              href={app.html_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-brand-fg underline-offset-4 hover:underline"
            >
              Manage on GitHub
              <ExternalLink aria-hidden="true" className="size-3" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {installed ? (
            <Button
              type="button"
              variant="ghost"
              aria-expanded={open}
              onClick={() => void toggleRepositories()}
            >
              Repositories
              <ChevronDown
                aria-hidden="true"
                data-icon="inline-end"
                className={cn(
                  'transition-transform motion-reduce:transition-none',
                  open && 'rotate-180',
                )}
              />
            </Button>
          ) : null}
          {installed ? (
            app.installations.map((item) => (
              <a
                key={item.id}
                href={installationSettingsUrl(item)}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'outline' })}
              >
                {app.installations.length === 1
                  ? 'Manage installation'
                  : `Manage ${item.account_login}`}
                <ExternalLink aria-hidden="true" data-icon="inline-end" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ))
          ) : (
            <Button
              type="button"
              variant="outline"
              loading={installing}
              onClick={onInstall}
            >
              Install
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${app.name}`}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      {installed ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {app.installations.map((item) => (
            <li
              key={item.id}
              className="rounded-md border border-border bg-surface-muted px-2.5 py-1 text-[13px] text-fg-secondary"
            >
              {item.account_login}
              <span className="text-muted-foreground">
                {' · '}
                {item.repository_selection === 'all'
                  ? 'All repositories'
                  : 'Selected repositories'}
              </span>
              {item.suspended ? (
                <span className="text-status-warning"> · Suspended</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Not installed on any account yet.
        </p>
      )}

      {open ? (
        <div className="mt-4 rounded-lg border border-border">
          {repositories.state === 'loading' ? (
            <div className="flex flex-col gap-2 p-3" aria-busy="true">
              <span className="sr-only">Loading repositories</span>
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : repositories.state === 'error' ? (
            <p role="alert" className="p-3 text-sm text-status-danger">
              {repositories.message}
            </p>
          ) : repositories.state === 'ready' ? (
            repositories.items.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                This App can see no repositories yet. Change its repository
                access on GitHub.
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {repositories.items.map((repo) => (
                  <li
                    key={repo.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                      {repo.private ? (
                        <Lock
                          aria-label="Private"
                          strokeWidth={1.75}
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                      <span className="truncate" title={repo.full_name}>
                        {repo.full_name}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {repo.default_branch}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
};
