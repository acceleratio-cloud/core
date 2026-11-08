'use client';

import { useCallback, useEffect, useState } from 'react';

import type { AuthSessionSummary } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { authApi } from '@/api/auth';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { SettingsSection } from '../components/settings-section';
import { Laptop, Smartphone } from 'lucide-react';
import {
  describeSessionClient,
  formatRelativeTime,
  sessionDeviceKind,
} from '../utils/password';

/** Current device first, then the most recently active. */
const sortSessions = (list: AuthSessionSummary[]) =>
  [...list].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      b.updated_at.localeCompare(a.updated_at),
  );

export const SessionsList = () => {
  const [sessions, setSessions] = useState<AuthSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { sessions: list } = await authApi.listSessions();
      setSessions(sortSessions(list));
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load sessions.'));
    }
  }, []);

  useEffect(() => {
    let active = true;

    authApi
      .listSessions()
      .then(({ sessions: list }) => {
        if (active) setSessions(sortSessions(list));
      })
      .catch((err) => {
        if (active)
          setError(getApiErrorMessage(err, 'Could not load sessions.'));
      });

    return () => {
      active = false;
    };
  }, []);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);

    try {
      await action();
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not end the session.'));
    } finally {
      setBusyId(null);
    }
  };

  const others = sessions?.filter((item) => !item.current) ?? [];

  return (
    <SettingsSection
      id="sessions"
      title="Active sessions"
      description="Where your account is signed in. End any you do not recognize."
      action={
        others.length > 0 ? (
          <Button
            variant="outline"
            loading={busyId === 'all'}
            onClick={() => run('all', authApi.revokeOtherSessions)}
          >
            Sign out all others
          </Button>
        ) : null
      }
    >
      {error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {sessions === null && !error ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        <ul className="divide-y divide-border" aria-label="Active sessions">
          {sessions?.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3.5 py-3.5 first:pt-0 last:pb-0"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
                {sessionDeviceKind(item.user_agent) === 'mobile' ? (
                  <Smartphone
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="size-4"
                  />
                ) : (
                  <Laptop
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="size-4"
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-foreground">
                  {describeSessionClient(item.user_agent)}
                  {item.current ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-normal text-status-success">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-status-success"
                      />
                      This device
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 truncate text-[13px] text-muted-foreground">
                  {item.ip_address ? `${item.ip_address} · ` : ''}
                  {item.current
                    ? 'Active now'
                    : `Active ${formatRelativeTime(item.updated_at)}`}
                  {' · '}Signed in{' '}
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    dateStyle: 'medium',
                  })}
                </p>
              </div>
              {item.current ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busyId === item.id}
                  aria-label={`Sign out ${describeSessionClient(item.user_agent)}`}
                  onClick={() =>
                    run(item.id, () => authApi.revokeSession(item.id))
                  }
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
};
