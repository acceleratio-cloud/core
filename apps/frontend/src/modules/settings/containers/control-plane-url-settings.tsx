'use client';

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { LoaderCircle } from 'lucide-react';
import { sileo } from 'sileo';

import type {
  ControlPlaneDnsCheck,
  ControlPlaneSettings,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { systemApi } from '@/api/system';
import { Button } from '@/shared/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { ControlPlaneDnsRecord } from '../components/control-plane-dns-record';
import { SettingsSection } from '../components/settings-section';
import { toComparableUrl, toDomain } from '../utils/control-plane-url';
import { ControlPlaneApplyDialog } from './control-plane-apply-dialog';

/** How often the change is re-read while the certificate is issued. */
const PROVISIONING_POLL_MS = 5000;

/**
 * Moves the console to a new root URL: save it, add the A record shown,
 * recheck until it resolves to this server, then apply. Applying publishes
 * the domain with an HTTPS certificate and redirects there.
 */
export const ControlPlaneUrlSettings = () => {
  const [settings, setSettings] = useState<ControlPlaneSettings | null>(null);
  const [draft, setDraft] = useState('');
  const [dns, setDns] = useState<ControlPlaneDnsCheck | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const pending = settings?.pending ?? null;
  const pendingUrl = pending?.url ?? null;
  const isProvisioning = pending?.status === 'provisioning';
  // The DNS block belongs to the saved URL; editing the input hides it.
  const showsPending =
    pending !== null && toComparableUrl(draft) === pending.url;
  const canApply =
    showsPending && !isProvisioning && !isChecking && dns?.status === 'valid';

  const checkDns = useCallback(async () => {
    setIsChecking(true);
    setError(null);

    try {
      setDns(await systemApi.checkDns());
    } catch (checkError) {
      setError(getApiErrorMessage(checkError));
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    systemApi
      .getControlPlane()
      .then((loaded) => {
        if (!active) {
          return;
        }

        setSettings(loaded);
        setDraft(toDomain(loaded.pending?.url ?? loaded.current_url));

        if (loaded.pending && loaded.pending.status !== 'provisioning') {
          void checkDns();
        }
      })
      .catch((loadFailure) => {
        if (active) {
          setLoadError(getApiErrorMessage(loadFailure));
        }
      });

    return () => {
      active = false;
    };
  }, [checkDns]);

  // While the certificate is issued, poll until the URL is promoted or fails.
  useEffect(() => {
    if (!isProvisioning || !pendingUrl) {
      return;
    }

    const targetUrl = pendingUrl;
    let active = true;
    const interval = window.setInterval(() => {
      systemApi
        .getControlPlane()
        .then((next) => {
          if (!active) {
            return;
          }

          setSettings(next);

          if (!next.pending && next.current_url === targetUrl) {
            sileo.success({
              title: 'Control plane URL changed',
              description: `Redirecting to ${targetUrl}`,
            });
            window.location.assign(targetUrl);
          }
        })
        .catch(() => {
          // Transient failures are retried on the next tick.
        });
    }, PROVISIONING_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [isProvisioning, pendingUrl]);

  const handleContinue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsContinuing(true);
    setError(null);
    setDns(null);

    try {
      const next = await systemApi.setPending({ url: draft });
      setSettings(next);
      setDns(next.pending?.dns ?? null);
      if (next.pending) {
        setDraft(toDomain(next.pending.url));
      }
    } catch (continueError) {
      setError(getApiErrorMessage(continueError));
    } finally {
      setIsContinuing(false);
    }
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    setError(null);

    try {
      const next = await systemApi.cancelPending();
      setSettings(next);
      setDns(null);
      setDraft(toDomain(next.current_url));
    } catch (cancelError) {
      setError(getApiErrorMessage(cancelError));
    } finally {
      setIsCancelling(false);
    }
  };

  const handleApply = async () => {
    setSettings(await systemApi.apply());
  };

  if (loadError) {
    return (
      <ControlPlaneSection>
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      </ControlPlaneSection>
    );
  }

  if (!settings) {
    return (
      <ControlPlaneSection>
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading the control plane URL</span>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
      </ControlPlaneSection>
    );
  }

  return (
    <ControlPlaneSection>
      <form onSubmit={handleContinue} noValidate>
        <Field>
          <FieldLabel htmlFor="system-control-plane-url">
            Control plane URL
          </FieldLabel>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="system-control-plane-url"
              name="control_plane_url"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="cloud.example.com"
              autoComplete="off"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              disabled={isProvisioning}
              aria-invalid={error ? true : undefined}
              className="font-mono"
            />
            <Button
              type="submit"
              variant={canApply ? 'outline' : 'default'}
              loading={isContinuing}
              disabled={isProvisioning || !draft.trim()}
            >
              Continue
            </Button>
          </div>
          <FieldDescription>
            {settings.current_url
              ? `Currently served at ${settings.current_url}.`
              : 'The console is served on the server address.'}
            {settings.fallback_url
              ? ` ${settings.fallback_url} always keeps working.`
              : ''}
          </FieldDescription>
          <FieldError>{error}</FieldError>
        </Field>
      </form>

      {showsPending && pending ? (
        <div className="mt-5 flex flex-col gap-4">
          {isProvisioning ? (
            <div
              role="status"
              className="flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-4 py-3 text-[13px] text-foreground"
            >
              <LoaderCircle
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              Issuing the HTTPS certificate for {pending.hostname}. You will be
              redirected when it is ready.
            </div>
          ) : (
            <ControlPlaneDnsRecord
              hostname={pending.hostname}
              dns={dns}
              checking={isChecking}
              onRecheck={checkDns}
            />
          )}

          {pending.status === 'failed' && pending.error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-[13px] text-foreground"
            >
              <span
                aria-hidden="true"
                className="mt-1 size-2 shrink-0 rounded-[1px] bg-status-danger"
              />
              {pending.error}
            </div>
          ) : null}

          {!isProvisioning ? (
            <div className="flex flex-wrap items-center gap-3">
              {canApply ? (
                <Button type="button" onClick={() => setConfirming(true)}>
                  {pending.status === 'failed'
                    ? 'Retry URL change'
                    : 'Apply URL change'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                loading={isCancelling}
                onClick={handleCancel}
              >
                Cancel change
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ControlPlaneApplyDialog
        url={confirming && pending ? pending.url : null}
        fallbackUrl={settings.fallback_url}
        onOpenChange={(open) => setConfirming(open)}
        onApply={handleApply}
      />
    </ControlPlaneSection>
  );
};

const ControlPlaneSection = ({ children }: { children: ReactNode }) => (
  <SettingsSection
    id="control-plane-url"
    title="Control plane URL"
    description="The address people open the console at. Moving it needs a DNS record and issues an HTTPS certificate."
  >
    {children}
  </SettingsSection>
);
