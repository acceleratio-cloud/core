'use client';

import { useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  Globe,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

import type { DnsCheck, WorkloadDomain } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadDomainsApi } from '@/api/workloads/domains';
import { cn } from '@/lib/utils';
import { DetailSection } from '@/modules/workloads/components/workload-details/detail-primitives';
import { useWorkloadDomains } from '@/modules/workloads/hooks/use-workload-domains';
import {
  canCheckCertificate,
  CUSTOM_DOMAINS_MAX,
  domainDisplayState,
  domainStateStyles,
  isDomainLive,
} from '@/modules/workloads/utils/workload-domains';
import { CopyButton } from '@/shared/components/copy-button';
import { buttonVariants } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useWorkloadActions } from './workload-actions';
import {
  AddCustomDomainDialog,
  DomainDnsInstructions,
  EditDomainPortDialog,
  GenerateDomainDialog,
  RemoveDomainDialog,
  useBodyRef,
} from './workload-domain-dialogs';

const MENU_ICON = 'size-3.5 text-fg-tertiary';

/** Shape and label, so the state reads without color. */
const DomainStatus = ({ domain }: { domain: WorkloadDomain }) => {
  const style = domainStateStyles[domainDisplayState(domain)];

  return (
    <span
      title={domain.status_message ?? style.description}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs',
        style.text,
      )}
    >
      <span aria-hidden="true" className={cn('shrink-0', style.dot)} />
      {style.label}
    </span>
  );
};

const DomainRow = ({
  domain,
  expanded,
  onToggle,
  onEditPort,
  onRemove,
  onCheckCertificate,
  checking,
  checkError,
  children,
}: {
  domain: WorkloadDomain;
  expanded: boolean;
  onToggle: () => void;
  onEditPort: () => void;
  onRemove: () => void;
  onCheckCertificate: () => void;
  checking: boolean;
  checkError: string | null;
  children?: ReactNode;
}) => {
  const bodyRef = useBodyRef();
  const live = isDomainLive(domain);
  const state = domainDisplayState(domain);
  // Routed but not trusted yet: the address answers with a certificate error.
  const sslNotice =
    state === 'issuing' || state === 'ssl_failed'
      ? (domain.status_message ?? domainStateStyles[state].description)
      : null;
  const needsDns =
    domain.kind === 'custom' &&
    (domain.status === 'verification' || domain.status === 'failed');

  return (
    <li className="group">
      <div className="flex min-h-14 items-center gap-3 py-2 pr-2 pl-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-0.5">
            {live ? (
              <a
                href={domain.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 rounded-sm font-mono text-[13px] leading-5 text-fg-primary underline-offset-2 hover:underline"
              >
                <span className="truncate" title={domain.hostname}>
                  {domain.hostname}
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3.5 shrink-0 text-fg-tertiary"
                />
              </a>
            ) : (
              <span
                className="truncate font-mono text-[13px] leading-5 text-fg-primary"
                title={domain.hostname}
              >
                {domain.hostname}
              </span>
            )}
            <CopyButton
              value={domain.url}
              label={`URL of ${domain.hostname}`}
              className="text-fg-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            />
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-fg-tertiary">
            <span>
              Port{' '}
              <span className="font-mono text-fg-secondary tabular-nums">
                {domain.port}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span>{domain.kind === 'generated' ? 'sslip.io' : 'Custom'}</span>
            {needsDns ? (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={onToggle}
                  className="inline-flex items-center gap-0.5 rounded-sm text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {expanded ? 'Hide DNS record' : 'DNS record'}
                  <ChevronDown
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className={cn(
                      'size-3 transition-transform motion-reduce:transition-none',
                      expanded && 'rotate-180',
                    )}
                  />
                </button>
              </>
            ) : null}
          </p>
        </div>

        <DomainStatus domain={domain} />

        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            aria-label={`Actions for ${domain.hostname}`}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <MoreHorizontal
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-4 text-fg-secondary"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            container={bodyRef}
            align="end"
            className="w-44 min-w-44"
          >
            {canCheckCertificate(domain) ? (
              <DropdownMenuItem
                onClick={onCheckCertificate}
                disabled={checking}
              >
                <RefreshCw
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className={MENU_ICON}
                />
                Check certificate now
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={onEditPort}>
              <Pencil
                aria-hidden="true"
                strokeWidth={1.75}
                className={MENU_ICON}
              />
              Change port
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onRemove}
              className="text-destructive data-[highlighted]:bg-destructive/10"
            >
              <Trash2
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5"
              />
              Remove domain
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {sslNotice ? (
        <div
          role="status"
          className={cn(
            'mx-3 mb-2.5 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs leading-relaxed',
            state === 'ssl_failed'
              ? 'border-destructive/30 bg-destructive/5 text-fg-secondary'
              : 'border-status-warning/30 bg-status-warning/5 text-fg-secondary',
          )}
        >
          {checking ? (
            <LoaderCircle
              aria-hidden="true"
              strokeWidth={1.75}
              className="mt-0.5 size-3.5 shrink-0 animate-spin text-fg-tertiary motion-reduce:animate-none"
            />
          ) : (
            <ShieldAlert
              aria-hidden="true"
              strokeWidth={1.75}
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                state === 'ssl_failed'
                  ? 'text-destructive'
                  : 'text-status-warning',
              )}
            />
          )}
          <span className="min-w-0">
            {checking ? 'Checking the certificate…' : sslNotice}
            {checkError && !checking ? (
              <span className="mt-0.5 block text-destructive">
                {checkError}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
      {expanded && needsDns ? (
        <div className="px-3 pb-3">{children}</div>
      ) : null}
    </li>
  );
};

/** The section's one action: a menu with both ways to add a domain. */
const AddDomainMenu = ({
  disabled,
  canGenerate,
  canAddCustom,
  onGenerate,
  onAddCustom,
}: {
  disabled: boolean;
  canGenerate: boolean;
  canAddCustom: boolean;
  onGenerate: () => void;
  onAddCustom: () => void;
}) => {
  const bodyRef = useBodyRef();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={disabled}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        <Plus data-icon="inline-start" aria-hidden="true" strokeWidth={1.75} />
        Add domain
        <ChevronDown
          data-icon="inline-end"
          aria-hidden="true"
          strokeWidth={1.75}
          className="text-fg-tertiary"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        container={bodyRef}
        align="end"
        className="w-64 min-w-64"
      >
        <DropdownMenuItem
          disabled={!canGenerate}
          onClick={onGenerate}
          className="h-auto items-start py-2"
        >
          <span className="flex flex-col gap-0.5">
            <span>Generate sslip.io domain</span>
            <span className="text-xs text-fg-tertiary">
              {canGenerate
                ? 'Free address that already points here.'
                : 'This service already has one.'}
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAddCustom}
          onClick={onAddCustom}
          className="h-auto items-start py-2"
        >
          <span className="flex flex-col gap-0.5">
            <span>Add custom domain</span>
            <span className="text-xs text-fg-tertiary">
              {canAddCustom
                ? 'A domain you own, through an A record.'
                : `Up to ${CUSTOM_DOMAINS_MAX} per service.`}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Domains of a Docker service: one generated sslip.io domain and custom
 * domains the user owns, each with its own target port and automatic HTTPS.
 * Changes apply at once and are not part of the draft or the versions. It
 * sits inside the config form; its buttons are `type="button"` and its
 * dialogs stop their submit events, so it never saves the draft.
 */
export const DockerWorkloadNetwork = () => {
  const { workload } = useWorkloadActions();
  const target = { projectId: workload.project_id, workloadId: workload.id };
  const { data, error, loading, upsert, drop } = useWorkloadDomains(
    target.projectId,
    target.workloadId,
  );
  const [generateOpen, setGenerateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<WorkloadDomain | null>(null);
  const [removing, setRemoving] = useState<WorkloadDomain | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Polls return no DNS check, so the latest one is kept per domain.
  const [checks, setChecks] = useState<Record<string, DnsCheck>>({});

  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});

  const checkCertificate = async (domain: WorkloadDomain) => {
    setCheckingId(domain.id);
    setCheckErrors((previous) => {
      const next = { ...previous };
      delete next[domain.id];
      return next;
    });

    try {
      applyDomain(
        await workloadDomainsApi.verify(
          target.projectId,
          target.workloadId,
          domain.id,
        ),
      );
    } catch (checkError) {
      setCheckErrors((previous) => ({
        ...previous,
        [domain.id]: getApiErrorMessage(checkError),
      }));
    } finally {
      setCheckingId(null);
    }
  };

  const applyDomain = (domain: WorkloadDomain) => {
    upsert(domain);
    if (domain.dns) {
      const dns = domain.dns;
      setChecks((previous) => ({ ...previous, [domain.id]: dns }));
    }
  };

  const domains = data?.domains ?? [];
  const hasGenerated = domains.some(({ kind }) => kind === 'generated');
  const customCount = domains.filter(({ kind }) => kind === 'custom').length;

  return (
    <>
      <DetailSection
        title="Domains"
        description="Public HTTPS addresses. Changes apply at once, without a deploy."
        action={
          <AddDomainMenu
            disabled={!data}
            canGenerate={!hasGenerated}
            canAddCustom={customCount < CUSTOM_DOMAINS_MAX}
            onGenerate={() => setGenerateOpen(true)}
            onAddCustom={() => setAddOpen(true)}
          />
        }
      >
        {loading && !data ? (
          <div className="flex flex-col gap-1.5 px-3 py-3">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-28" />
          </div>
        ) : domains.length > 0 ? (
          <ul className="divide-y divide-edge-subtle">
            {domains.map((domain) => (
              <DomainRow
                key={domain.id}
                domain={domain}
                expanded={expanded === domain.id}
                onCheckCertificate={() => void checkCertificate(domain)}
                checking={checkingId === domain.id}
                checkError={checkErrors[domain.id] ?? null}
                onToggle={() =>
                  setExpanded((current) =>
                    current === domain.id ? null : domain.id,
                  )
                }
                onEditPort={() => setEditing(domain)}
                onRemove={() => setRemoving(domain)}
              >
                <DomainDnsInstructions
                  target={target}
                  domain={domain}
                  expectedIp={data?.expected_ip ?? null}
                  dns={checks[domain.id] ?? null}
                  onVerified={applyDomain}
                />
              </DomainRow>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 px-3 py-3.5">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-edge-default bg-surface-sunken"
            >
              <Globe strokeWidth={1.75} className="size-4 text-fg-tertiary" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] leading-5 text-fg-primary">
                No public domain
              </p>
              <p className="text-xs leading-5 text-fg-tertiary">
                Only services in this project can reach it, by its private
                hostname.
              </p>
            </div>
          </div>
        )}

        {error ? (
          <p
            role="alert"
            className="border-t border-edge-subtle px-3 py-2.5 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
      </DetailSection>

      {data ? (
        <GenerateDomainDialog
          key={`generate-${generateOpen}`}
          open={generateOpen}
          onOpenChange={setGenerateOpen}
          target={target}
          domains={data}
          onGenerated={applyDomain}
        />
      ) : null}
      <AddCustomDomainDialog
        key={`add-${addOpen}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        target={target}
        expectedIp={data?.expected_ip ?? null}
        onAdded={applyDomain}
      />
      <EditDomainPortDialog
        key={`edit-${editing?.id ?? 'closed'}`}
        domain={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        target={target}
        onUpdated={applyDomain}
      />
      <RemoveDomainDialog
        key={`remove-${removing?.id ?? 'closed'}`}
        domain={removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        target={target}
        onRemoved={drop}
      />
    </>
  );
};
