'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { sileo } from 'sileo';

import type {
  PlatformUpdate,
  PlatformUpdateDetails,
  PlatformVersionInfo,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { cn } from '@/lib/utils';
import { systemApi } from '@/api/system';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { PlatformComponentsList } from '../components/platform-components-list';
import { PlatformReleaseNotes } from '../components/platform-release-notes';
import { PlatformUpdateHistory } from '../components/platform-update-history';
import { PlatformUpdateProgress } from '../components/platform-update-progress';
import { SettingsRow } from '../components/settings-row';
import { SettingsSection } from '../components/settings-section';
import {
  formatVersion,
  isUpdateActive,
  platformStatus,
} from '../utils/platform-update';
import { PlatformUpdateDialog } from './platform-update-dialog';

/** How often a running update is re-read. */
const UPDATE_POLL_MS = 3000;

type PlatformTab = 'releases' | 'components' | 'history';

/**
 * The installed release at a glance, with the one action that matters next
 * (update, or check again), and tabs for release notes, components and the
 * update history.
 */
export const PlatformVersionSettings = () => {
  const [info, setInfo] = useState<PlatformVersionInfo | null>(null);
  // The update in progress, or the one that finished while this page watched.
  const [update, setUpdate] = useState<PlatformUpdateDetails | null>(null);
  const [history, setHistory] = useState<PlatformUpdate[] | null>(null);
  const [selected, setSelected] = useState<PlatformUpdateDetails | null>(null);
  const [tab, setTab] = useState<PlatformTab | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState<string | null>(null);
  // The console was replaced by the update: its loaded code is outdated.
  const [needsReload, setNeedsReload] = useState(false);

  const updateId = update?.id ?? null;
  const updateRunning = isUpdateActive(update);

  const loadHistory = useCallback(() => {
    systemApi
      .listUpdates()
      .then(setHistory)
      .catch(() => setHistory((current) => current ?? []));
  }, []);

  useEffect(() => {
    let active = true;

    systemApi
      .getPlatform()
      .then(async (loaded) => {
        if (!active) {
          return;
        }

        setInfo(loaded);

        if (loaded.active_update) {
          const details = await systemApi.getUpdate(loaded.active_update.id);

          if (active) {
            setUpdate(details);
          }
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError(getApiErrorMessage(error));
        }
      });
    loadHistory();

    return () => {
      active = false;
    };
  }, [loadHistory]);

  // Follow a running update. The API restarts during it, so failed reads
  // are expected: they switch to a reconnecting state and keep polling.
  useEffect(() => {
    if (!updateId || !updateRunning) {
      return;
    }

    let active = true;
    const interval = window.setInterval(() => {
      systemApi
        .getUpdate(updateId)
        .then(async (next) => {
          if (!active) {
            return;
          }

          setReconnecting(false);

          if (isUpdateActive(next)) {
            setUpdate(next);
            return;
          }

          // Re-read the versions before showing the outcome: the finished
          // update ends this effect, which would drop a later response.
          const refreshed = await systemApi.getPlatform().catch(() => null);

          if (!active) {
            return;
          }

          if (refreshed) {
            setInfo(refreshed);
          }

          setUpdate(next);
          loadHistory();

          if (next.status === 'succeeded') {
            setNeedsReload(true);
            sileo.success({
              title: `Updated to ${formatVersion(next.to_version)}`,
              description: 'Reload the console to use the new version.',
            });
          } else {
            sileo.error({
              title:
                next.status === 'rolled_back'
                  ? 'Update rolled back'
                  : 'Update failed',
              description: next.message ?? undefined,
            });
          }
        })
        .catch(() => {
          if (active) {
            setReconnecting(true);
          }
        });
    }, UPDATE_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [updateId, updateRunning, loadHistory]);

  const handleCheck = async () => {
    setIsChecking(true);

    try {
      const next = await systemApi.checkForUpdates();
      setInfo(next);

      if (next.check_error) {
        sileo.error({
          title: 'Could not check for updates',
          description: next.check_error,
        });
      } else if (next.update_available) {
        setTab('releases');
      } else {
        sileo.info({ title: 'The platform is up to date' });
      }
    } catch (error) {
      sileo.error({
        title: 'Could not check for updates',
        description: getApiErrorMessage(error),
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleUpdate = async (version: string) => {
    const started = await systemApi.startUpdate({ version });
    setUpdate(started);
    setReconnecting(false);
    setNeedsReload(false);
    setInfo((current) =>
      current ? { ...current, active_update: started } : current,
    );
    loadHistory();
  };

  const handleSelect = async (id: string) => {
    if (selected?.id === id) {
      setSelected(null);
      return;
    }

    try {
      setSelected(await systemApi.getUpdate(id));
    } catch (error) {
      sileo.error({
        title: 'Could not load the update',
        description: getApiErrorMessage(error),
      });
    }
  };

  if (loadError) {
    return (
      <PlatformSection>
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      </PlatformSection>
    );
  }

  if (!info) {
    return (
      <PlatformSection>
        <div aria-busy="true" className="-mt-4 divide-y divide-border">
          <span className="sr-only">Loading the platform version</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="grid items-center gap-x-6 gap-y-1.5 py-4 sm:grid-cols-[168px_minmax(0,1fr)_auto]"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </PlatformSection>
    );
  }

  const status = platformStatus({
    ...info,
    active_update: update && updateRunning ? update : info.active_update,
  });
  const latest = info.releases[0] ?? null;
  const canUpdate =
    latest !== null && !info.update_blocked_reason && !updateRunning;
  const activeTab: PlatformTab =
    tab ?? (info.releases.length > 0 ? 'releases' : 'components');

  return (
    <PlatformSection>
      <div className="flex flex-col gap-5">
        <div className="-mt-4 divide-y divide-border">
          <SettingsRow id="platform-installed" label="Installed">
            <span className="font-mono tabular-nums">
              {info.current_version
                ? formatVersion(info.current_version)
                : 'Development build'}
            </span>
          </SettingsRow>

          <SettingsRow
            id="platform-latest"
            label="Latest release"
            hint={
              latest && info.update_blocked_reason && !updateRunning
                ? info.update_blocked_reason
                : undefined
            }
            action={
              latest && canUpdate ? (
                <Button
                  type="button"
                  onClick={() => setConfirmVersion(latest.version)}
                >
                  Update to {formatVersion(latest.version)}
                </Button>
              ) : null
            }
          >
            {info.latest_version ? (
              <span className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="font-mono tabular-nums">
                  {formatVersion(info.latest_version)}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[13px]',
                    status.tone === 'info'
                      ? 'text-brand-fg'
                      : 'text-muted-foreground',
                  )}
                >
                  {status.tone === 'info' ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 rounded-full bg-brand-fg',
                        updateRunning &&
                          'animate-pulse motion-reduce:animate-none',
                      )}
                    />
                  ) : null}
                  {updateRunning
                    ? status.label
                    : info.update_available
                      ? `${info.releases.length} newer ${info.releases.length === 1 ? 'release' : 'releases'}`
                      : 'Up to date'}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Not checked yet</span>
            )}
          </SettingsRow>

          <SettingsRow
            id="platform-checked"
            label="Last checked"
            hint={
              info.check_error ? (
                <span className="text-status-danger">{info.check_error}</span>
              ) : undefined
            }
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={isChecking}
                disabled={updateRunning}
                onClick={handleCheck}
              >
                Check now
              </Button>
            }
          >
            <span className="text-muted-foreground">
              {info.checked_at ? (
                <>
                  <time
                    dateTime={info.checked_at}
                    title={formatAbsoluteTime(info.checked_at)}
                    className="text-foreground"
                  >
                    {formatRelativeTime(info.checked_at)}
                  </time>{' '}
                  from {info.release_source}
                </>
              ) : (
                `Never; releases come from ${info.release_source}`
              )}
            </span>
          </SettingsRow>
        </div>

        {needsReload ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-success/30 bg-status-success/5 px-4 py-3 text-[13px] text-foreground"
          >
            The console was updated. Reload it to use the new version.
            <Button
              type="button"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RotateCw aria-hidden="true" strokeWidth={1.75} />
              Reload console
            </Button>
          </div>
        ) : null}

        {update ? (
          <PlatformUpdateProgress update={update} reconnecting={reconnecting} />
        ) : null}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setTab(value as PlatformTab)}
        >
          <TabsList>
            {info.releases.length > 0 ? (
              <TabsTrigger value="releases">
                What&apos;s new
                <span className="rounded-full bg-surface-muted px-1.5 text-[11px] tabular-nums">
                  {info.releases.length}
                </span>
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="components">Components</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {info.releases.length > 0 ? (
            <TabsContent value="releases" className="pt-4">
              <PlatformReleaseNotes releases={info.releases} />
            </TabsContent>
          ) : null}

          <TabsContent value="components" className="pt-4">
            <PlatformComponentsList components={info.components} />
          </TabsContent>

          <TabsContent value="history" className="flex flex-col gap-4 pt-4">
            {history === null ? (
              <div aria-busy="true" className="flex flex-col gap-2">
                <span className="sr-only">Loading the update history</span>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <PlatformUpdateHistory
                updates={history}
                selectedId={selected?.id ?? null}
                onSelect={handleSelect}
              />
            )}
            {selected && selected.id !== update?.id ? (
              <PlatformUpdateProgress update={selected} reconnecting={false} />
            ) : null}
          </TabsContent>
        </Tabs>
      </div>

      <PlatformUpdateDialog
        version={confirmVersion}
        currentVersion={info.current_version}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmVersion(null);
          }
        }}
        onUpdate={handleUpdate}
      />
    </PlatformSection>
  );
};

const PlatformSection = ({ children }: { children: ReactNode }) => (
  <SettingsSection
    id="platform-version"
    title="Platform version"
    description="The installed release, its components and updates from GitHub. Updates install on the server, without SSH."
  >
    {children}
  </SettingsSection>
);
