import type { VulnerabilitySeverity } from '@acceleratio/shared';

import { cn } from '@/lib/utils';

export const SEVERITY_LABEL: Record<VulnerabilitySeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
};

/** Text color of a severity; the label always says it too. */
export const SEVERITY_TEXT: Record<VulnerabilitySeverity, string> = {
  critical: 'text-status-danger',
  high: 'text-status-warning',
  medium: 'text-foreground',
  low: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
};

const DOT: Record<VulnerabilitySeverity, string> = {
  critical: 'bg-status-danger',
  high: 'bg-status-warning',
  medium: 'bg-foreground/60',
  low: 'bg-muted-foreground/60',
  unknown: 'bg-muted-foreground/30',
};

export const SeverityBadge = ({
  severity,
}: {
  severity: VulnerabilitySeverity;
}) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] leading-none font-medium text-foreground">
    <span
      aria-hidden="true"
      className={cn('size-1.5 rounded-full', DOT[severity])}
    />
    {SEVERITY_LABEL[severity]}
  </span>
);
