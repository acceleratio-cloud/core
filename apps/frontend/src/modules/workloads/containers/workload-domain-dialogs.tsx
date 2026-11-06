'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Globe, Sparkles, Trash2 } from 'lucide-react';

import type {
  DnsCheck,
  WorkloadDomain,
  WorkloadDomains,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadDomainsApi } from '@/api/workloads/domains';
import {
  cleanHostname,
  labelError,
  maxLabelLength,
  parsePort,
  PORT_ERROR,
} from '@/modules/workloads/utils/workload-domains';
import { DnsRecord } from '@/shared/components/dns-record';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';

/** The drawer ignores pointer events, so dialogs and menus mount on the body. */
export const useBodyRef = () => {
  const bodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    bodyRef.current = document.body;
  }, []);

  return bodyRef;
};

type Target = { projectId: string; workloadId: string };

const APPLIES_NOW =
  'Applies immediately. The service keeps running and does not need a deploy.';

/** Port field shared by every dialog: the container port traffic goes to. */
const PortField = ({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) => (
  <Field data-invalid={error ? true : undefined}>
    <FieldLabel htmlFor={id}>Port</FieldLabel>
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      placeholder="8080"
      value={value}
      aria-invalid={!!error}
      onChange={(event) => onChange(event.target.value)}
      className="font-mono tabular-nums"
    />
    <FieldDescription>
      The port your container listens on. HTTPS on 443 is forwarded to it.
    </FieldDescription>
    <FieldError errors={error ? [{ message: error }] : []} />
  </Field>
);

export const SubmitError = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="mt-4 text-xs leading-relaxed text-destructive">
      {error}
    </p>
  ) : null;

export const DialogShell = ({
  open,
  busy,
  onOpenChange,
  children,
  wide = false,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  wide?: boolean;
}) => {
  const bodyRef = useBodyRef();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          onOpenChange(next);
        }
      }}
    >
      <DialogContent
        container={bodyRef}
        showCloseButton={!busy}
        className={wide ? 'sm:max-w-xl' : undefined}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};

/**
 * Each dialog keeps its form state for one opening; the parent remounts it
 * with a new `key` per opening, so nothing leaks from the previous one.
 */

/** Creates the service's single sslip.io domain. */
export const GenerateDomainDialog = ({
  open,
  onOpenChange,
  target,
  domains,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  domains: WorkloadDomains;
  onGenerated: (domain: WorkloadDomain) => void;
}) => {
  const labelId = useId();
  const portId = useId();
  const [label, setLabel] = useState(domains.suggested_label);
  const [port, setPort] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suffix = domains.generated_suffix;
  const maxLength = maxLabelLength(suffix);

  const labelProblem = labelError(label, maxLength);
  const parsedPort = parsePort(port);
  const preview = `${label.trim().toLowerCase() || 'label'}${suffix ?? ''}`;

  const submit = async () => {
    setTouched(true);

    if (labelProblem || parsedPort === null || !suffix) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const domain = await workloadDomainsApi.generate(
        target.projectId,
        target.workloadId,
        { label: label.trim().toLowerCase(), port: parsedPort },
      );
      onGenerated(domain);
      onOpenChange(false);
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={open} busy={busy} onOpenChange={onOpenChange}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // Dialogs render inside the config form in the React tree, and
          // React submit events bubble through portals.
          event.stopPropagation();
          void submit();
        }}
      >
        <DialogHeader>
          <DialogTitle>Generate domain</DialogTitle>
          <DialogDescription>
            A free sslip.io address that already points to this server, with
            HTTPS. {APPLIES_NOW}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 flex flex-col gap-5">
          {suffix ? (
            <Field data-invalid={touched && labelProblem ? true : undefined}>
              <FieldLabel htmlFor={labelId}>Label</FieldLabel>
              <div className="flex min-w-0 items-center gap-1.5">
                <Input
                  id={labelId}
                  autoComplete="off"
                  autoFocus
                  value={label}
                  maxLength={maxLength}
                  aria-invalid={touched && !!labelProblem}
                  onChange={(event) => setLabel(event.target.value)}
                  className="min-w-0 flex-1 font-mono"
                />
                <span className="shrink-0 font-mono text-xs text-fg-tertiary">
                  {suffix}
                </span>
              </div>
              <FieldDescription className="font-mono break-all">
                https://{preview}
              </FieldDescription>
              <FieldError
                errors={
                  touched && labelProblem ? [{ message: labelProblem }] : []
                }
              />
            </Field>
          ) : (
            <p className="text-xs leading-relaxed text-destructive">
              The server public IP is unknown, so a domain cannot be generated.
              Set ACCELERATIO_PUBLIC_IP on the API.
            </p>
          )}

          <PortField
            id={portId}
            value={port}
            onChange={setPort}
            error={touched && parsedPort === null ? PORT_ERROR : null}
          />
        </div>

        <SubmitError error={error} />

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!suffix}>
            <Sparkles
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            {busy ? 'Generating' : 'Generate'}
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
};

/** The record to create for a custom domain, with a live check. */
export const DomainDnsInstructions = ({
  target,
  domain,
  expectedIp,
  dns,
  onVerified,
}: {
  target: Target;
  domain: WorkloadDomain;
  expectedIp: string | null;
  dns: DnsCheck | null;
  onVerified: (domain: WorkloadDomain) => void;
}) => {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recheck = async () => {
    setChecking(true);
    setError(null);

    try {
      onVerified(
        await workloadDomainsApi.verify(
          target.projectId,
          target.workloadId,
          domain.id,
        ),
      );
    } catch (verifyError) {
      setError(getApiErrorMessage(verifyError));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <DnsRecord
        hostname={domain.hostname}
        expectedIp={domain.dns_records[0]?.value ?? expectedIp}
        dns={dns}
        checking={checking}
        onRecheck={() => void recheck()}
        idleLabel={domain.status_message}
      />
      {domain.routed && domain.status === 'verification' ? (
        <p className="text-xs leading-relaxed text-fg-tertiary">
          The record is in place. Let&apos;s Encrypt is issuing the certificate;
          this usually takes under a minute and at most 10.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-fg-tertiary">
          Nothing is routed until the record resolves. The console checks it in
          the background, so you can close this and come back later. If your
          domain has a CAA record, it must allow letsencrypt.org.
        </p>
      )}
      <SubmitError error={error} />
    </div>
  );
};

/** Adds a custom domain, then shows the DNS record to create. */
export const AddCustomDomainDialog = ({
  open,
  onOpenChange,
  target,
  expectedIp,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  expectedIp: string | null;
  onAdded: (domain: WorkloadDomain) => void;
}) => {
  const hostnameId = useId();
  const portId = useId();
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<WorkloadDomain | null>(null);

  const cleaned = cleanHostname(hostname);
  const hostnameProblem = cleaned.includes('.')
    ? null
    : 'Enter a domain name such as app.example.com.';
  const parsedPort = parsePort(port);

  const submit = async () => {
    setTouched(true);

    if (hostnameProblem || parsedPort === null) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const domain = await workloadDomainsApi.add(
        target.projectId,
        target.workloadId,
        { hostname: cleaned, port: parsedPort },
      );
      setAdded(domain);
      onAdded(domain);
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      busy={busy}
      onOpenChange={onOpenChange}
      wide={added !== null}
    >
      {added ? (
        <>
          <DialogHeader>
            <DialogTitle>Point {added.hostname} to this server</DialogTitle>
            <DialogDescription>
              Create this record at your DNS provider. HTTPS is set up
              automatically once it resolves.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5">
            <DomainDnsInstructions
              target={target}
              domain={added}
              expectedIp={expectedIp}
              dns={added.dns}
              onVerified={(domain) => {
                setAdded(domain);
                onAdded(domain);
              }}
            />
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            // Dialogs render inside the config form in the React tree, and
            // React submit events bubble through portals.
            event.stopPropagation();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add custom domain</DialogTitle>
            <DialogDescription>
              A domain you own. It goes live with HTTPS once its A record points
              to this server. {APPLIES_NOW}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex flex-col gap-5">
            <Field data-invalid={touched && hostnameProblem ? true : undefined}>
              <FieldLabel htmlFor={hostnameId}>Domain</FieldLabel>
              <Input
                id={hostnameId}
                autoComplete="off"
                autoFocus
                spellCheck={false}
                placeholder="app.example.com"
                value={hostname}
                aria-invalid={touched && !!hostnameProblem}
                onChange={(event) => setHostname(event.target.value)}
                className="font-mono"
              />
              <FieldError
                errors={
                  touched && hostnameProblem
                    ? [{ message: hostnameProblem }]
                    : []
                }
              />
            </Field>

            <PortField
              id={portId}
              value={port}
              onChange={setPort}
              error={touched && parsedPort === null ? PORT_ERROR : null}
            />
          </div>

          <SubmitError error={error} />

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              <Globe
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              {busy ? 'Adding' : 'Add domain'}
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogShell>
  );
};

/** Changes the port a domain sends traffic to. */
export const EditDomainPortDialog = ({
  domain,
  onOpenChange,
  target,
  onUpdated,
}: {
  domain: WorkloadDomain | null;
  onOpenChange: (open: boolean) => void;
  target: Target;
  onUpdated: (domain: WorkloadDomain) => void;
}) => {
  const portId = useId();
  const [port, setPort] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPort = parsePort(port);

  const submit = async () => {
    setTouched(true);

    if (!domain || parsedPort === null) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      onUpdated(
        await workloadDomainsApi.update(
          target.projectId,
          target.workloadId,
          domain.id,
          { port: parsedPort },
        ),
      );
      onOpenChange(false);
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={domain !== null} busy={busy} onOpenChange={onOpenChange}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // Dialogs render inside the config form in the React tree, and
          // React submit events bubble through portals.
          event.stopPropagation();
          void submit();
        }}
      >
        <DialogHeader>
          <DialogTitle>Change port</DialogTitle>
          <DialogDescription>
            Traffic for <code className="font-mono">{domain?.hostname}</code>{' '}
            goes to this port. {APPLIES_NOW}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5">
          <PortField
            id={portId}
            value={port}
            onChange={setPort}
            error={touched && parsedPort === null ? PORT_ERROR : null}
          />
        </div>

        <SubmitError error={error} />

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? 'Saving' : 'Save port'}
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
};

/** Confirms removing a domain; it stops serving at once. */
export const RemoveDomainDialog = ({
  domain,
  onOpenChange,
  target,
  onRemoved,
}: {
  domain: WorkloadDomain | null;
  onOpenChange: (open: boolean) => void;
  target: Target;
  onRemoved: (domainId: string) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!domain) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await workloadDomainsApi.remove(
        target.projectId,
        target.workloadId,
        domain.id,
      );
      onRemoved(domain.id);
      onOpenChange(false);
    } catch (removeError) {
      setError(getApiErrorMessage(removeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={domain !== null} busy={busy} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Remove domain</DialogTitle>
        <DialogDescription>
          <code className="font-mono">{domain?.hostname}</code> stops serving
          this service immediately.
          {domain?.kind === 'custom'
            ? ' You can delete its DNS record afterwards.'
            : ' You can generate a new domain later.'}
        </DialogDescription>
      </DialogHeader>

      <SubmitError error={error} />

      <DialogFooter className="mt-5">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          loading={busy}
          onClick={() => void remove()}
        >
          <Trash2
            data-icon="inline-start"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          {busy ? 'Removing' : 'Remove domain'}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
};
