import { LoaderCircle, RefreshCw } from 'lucide-react';

import type { DnsCheck } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/shared/components/copy-button';
import { Button } from '@/shared/components/ui/button';

type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

const SHAPES: Record<StatusTone, string> = {
  // Shape as well as color: circle, triangle, square, hollow circle.
  success: 'size-2 rounded-full bg-status-success',
  warning:
    'size-2.5 bg-status-warning [clip-path:polygon(50%_0,100%_100%,0_100%)]',
  danger: 'size-2 rounded-[1px] bg-status-danger',
  neutral: 'size-2 rounded-full border border-muted-foreground',
};

const describe = (dns: DnsCheck): { tone: StatusTone; label: string } => {
  switch (dns.status) {
    case 'valid':
      return {
        tone: 'success',
        label: 'Record found. It points to this server.',
      };
    case 'mismatch':
      return {
        tone: 'warning',
        label: `Points to ${dns.records.join(', ')} instead of ${dns.expected_ip}.`,
      };
    case 'missing':
      return { tone: 'neutral', label: 'No A record found yet.' };
    default:
      return { tone: 'danger', label: dns.message ?? 'DNS lookup failed.' };
  }
};

const RecordValue = ({ label, value }: { label: string; value: string }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="flex min-w-0 items-center gap-1">
      <span
        className="truncate font-mono text-[13px] text-foreground"
        title={value}
      >
        {value}
      </span>
      <CopyButton value={value} label={label.toLowerCase()} />
    </span>
  </div>
);

type DnsRecordProps = {
  hostname: string;
  /** Address to show before a check ran; the check's own address wins. */
  expectedIp?: string | null;
  dns: DnsCheck | null;
  checking: boolean;
  onRecheck: () => void;
  /** Shown instead of a spinner while no check has run in this view. */
  idleLabel?: string | null;
  className?: string;
};

/** The A record to create and what public resolvers currently return. */
export const DnsRecord = ({
  hostname,
  expectedIp: fallbackIp = null,
  dns,
  checking,
  onRecheck,
  idleLabel = null,
  className,
}: DnsRecordProps) => {
  const expectedIp = dns?.expected_ip ?? fallbackIp;
  const status = dns
    ? describe(dns)
    : idleLabel
      ? { tone: 'neutral' as const, label: idleLabel }
      : null;
  const warning = dns && dns.status !== 'error' ? dns.message : null;

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface-sunken',
        className,
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">
          Point the domain to this server
        </h3>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          At your DNS provider, add this A record. Some providers want only the
          subdomain part in the name field.
        </p>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Type</span>
          <span className="font-mono text-[13px] text-foreground">A</span>
        </div>
        <RecordValue label="Name" value={hostname} />
        {expectedIp ? (
          <RecordValue label="Value" value={expectedIp} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Value</span>
            <span className="text-[13px] text-muted-foreground">
              {dns ? 'Unknown' : '…'}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div role="status" className="flex min-w-0 flex-col gap-1">
          {checking || !status ? (
            <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
              <LoaderCircle
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              Checking DNS…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-[13px] text-foreground">
              <span
                aria-hidden="true"
                className={cn('shrink-0', SHAPES[status.tone])}
              />
              {status.label}
            </span>
          )}
          {dns && !checking ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              Checked at {new Date(dns.checked_at).toLocaleTimeString()}. DNS
              changes can take a few minutes to appear.
            </span>
          ) : null}
          {warning && !checking ? (
            <span className="text-xs text-status-warning">{warning}</span>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRecheck}
          disabled={checking}
        >
          <RefreshCw aria-hidden="true" strokeWidth={1.75} />
          Recheck
        </Button>
      </div>
    </div>
  );
};
