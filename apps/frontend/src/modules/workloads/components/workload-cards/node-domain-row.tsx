'use client';

import { ArrowUpRight, Globe } from 'lucide-react';

import type { Workload, WorkloadDomain } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { useWorkloadDomains } from '@/modules/workloads/hooks/use-workload-domains';
import {
  domainDisplayState,
  domainStateStyles,
  isDomainLive,
} from '@/modules/workloads/utils/workload-domains';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

/** Custom domains first: they are the address people actually share. */
const byPreference = (a: WorkloadDomain, b: WorkloadDomain) =>
  Number(isDomainLive(b)) - Number(isDomainLive(a)) ||
  Number(b.kind === 'custom') - Number(a.kind === 'custom');

/**
 * The card's quick way out to the running service: the main live domain as a
 * link and, when there are more, a counter that lists them all. Hidden while
 * the service has no domain. Clicks stay here instead of selecting the card.
 */
export const NodeDomainRow = ({ workload }: { workload: Workload }) => {
  const { data } = useWorkloadDomains(workload.project_id, workload.id);
  const domains = [...(data?.domains ?? [])].sort(byPreference);
  const [primary] = domains;

  if (!primary) {
    return null;
  }

  const live = isDomainLive(primary);
  const others = domains.length - 1;

  return (
    <div className="flex h-7 items-center gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Globe aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        Domain
      </dt>
      <dd
        className="nodrag nopan ml-auto flex min-w-0 items-center justify-end gap-1"
        // React bubbles portal events through the tree, so this also covers
        // the menu, which renders outside the card.
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {live ? (
          <a
            href={primary.url}
            target="_blank"
            rel="noreferrer"
            title={`Open ${primary.url}`}
            className="group/link inline-flex min-w-0 cursor-pointer items-center gap-0.5 rounded-xs font-mono text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <span className="truncate">{primary.hostname}</span>
            <ArrowUpRight
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3 shrink-0 text-fg-tertiary group-hover/link:text-foreground"
            />
          </a>
        ) : (
          <span
            title={`${primary.hostname}: ${domainStateStyles[domainDisplayState(primary)].label}`}
            className="truncate font-mono text-xs text-fg-tertiary"
          >
            {primary.hostname}
          </span>
        )}

        {others > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              aria-label={`All ${domains.length} domains of ${workload.name}`}
              className="h-4.5 shrink-0 cursor-pointer rounded-sm border border-edge-default bg-surface-sunken px-1 font-mono text-[11px] leading-none text-fg-secondary tabular-nums transition-colors hover:border-edge-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-[popup-open]:border-edge-control data-[popup-open]:text-foreground"
            >
              +{others}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 min-w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Domains</DropdownMenuLabel>
                {domains.map((domain) => (
                  <DomainMenuItem key={domain.id} domain={domain} />
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </dd>
    </div>
  );
};

const DomainMenuItem = ({ domain }: { domain: WorkloadDomain }) => {
  const style = domainStateStyles[domainDisplayState(domain)];
  const dot = <span aria-hidden="true" className={cn('shrink-0', style.dot)} />;
  const hostname = (
    <span className="min-w-0 flex-1 truncate font-mono text-xs">
      {domain.hostname}
    </span>
  );

  if (!isDomainLive(domain)) {
    // Not openable yet: shown with its state, so the list stays complete.
    return (
      <DropdownMenuItem
        disabled
        title={domain.status_message ?? style.description}
        className="gap-2"
      >
        {dot}
        {hostname}
        <span className={cn('shrink-0 text-xs', style.text)}>
          {style.label}
        </span>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuLinkItem
      href={domain.url}
      target="_blank"
      rel="noreferrer"
      title={`Open ${domain.url}`}
      className="group/item gap-2"
    >
      {dot}
      {hostname}
      <ArrowUpRight
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0 text-fg-tertiary group-data-[highlighted]/item:text-foreground"
      />
    </DropdownMenuLinkItem>
  );
};
