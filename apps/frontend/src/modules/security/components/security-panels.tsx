import type {
  ServiceSecurityStatus,
  VulnerabilityCounts,
  VulnerabilitySeverity,
} from '@acceleratio/shared';

import { cn } from '@/lib/utils';
import { Panel } from '@/modules/observability/components/panel';
import { EmptyWell } from '@/modules/observability/components/timeseries-panel';
import { SEVERITY_LABEL } from './severity-badge';

/** Most pressing first: the order of the bar, the legend and the table. */
export const SERVICE_STATUSES: {
  status: ServiceSecurityStatus;
  label: string;
  hint: string;
  dot: string;
  text?: string;
}[] = [
  {
    status: 'action',
    label: 'Need action',
    hint: 'a fix you can apply now',
    dot: 'bg-status-danger',
    text: 'text-status-danger',
  },
  {
    status: 'update',
    label: 'Update available',
    hint: 'no rush',
    dot: 'bg-status-warning',
    text: 'text-status-warning',
  },
  {
    status: 'platform',
    label: 'Handled by Acceleratio',
    hint: 'fixed by a platform update',
    dot: 'bg-fg-secondary',
  },
  {
    status: 'waiting',
    label: 'Waiting for fixes',
    hint: 'nothing to do yet',
    dot: 'bg-fg-tertiary',
  },
  {
    status: 'pending',
    label: 'Not scanned yet',
    hint: 'in the scan queue',
    dot: 'bg-edge-strong',
  },
  {
    status: 'ok',
    label: 'Up to date',
    hint: 'no known issues',
    dot: 'bg-status-success',
    text: 'text-status-success',
  },
];

export const statusMeta = (status: ServiceSecurityStatus) =>
  SERVICE_STATUSES.find((item) => item.status === status) ??
  SERVICE_STATUSES[0];

const SEVERITY_BAR: Record<VulnerabilitySeverity, string> = {
  critical: 'bg-status-danger',
  high: 'bg-status-warning',
  medium: 'bg-fg-secondary',
  low: 'bg-fg-tertiary',
  unknown: 'bg-edge-strong',
};

export const SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
] as const;

export const totalOf = (counts: VulnerabilityCounts) =>
  SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);

/** One bar split by severity: what a service's findings are made of. */
export const SeverityMix = ({
  counts,
  className,
}: {
  counts: VulnerabilityCounts;
  className?: string;
}) => {
  const total = totalOf(counts);

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-1.5 overflow-hidden rounded-full bg-surface-muted',
        className,
      )}
    >
      {total > 0
        ? SEVERITIES.map((severity) =>
            counts[severity] > 0 ? (
              <span
                key={severity}
                className={SEVERITY_BAR[severity]}
                style={{ width: `${(counts[severity] / total) * 100}%` }}
              />
            ) : null,
          )
        : null}
    </span>
  );
};

/** How many services are in each state, as one bar and its legend. */
export const ServiceStatusPanel = ({
  counts,
}: {
  counts: Record<ServiceSecurityStatus, number>;
}) => {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <Panel
      title="Services by status"
      hint={`${total} ${total === 1 ? 'service' : 'services'}`}
      wellClassName="min-h-56"
    >
      {total === 0 ? (
        <EmptyWell label="No services with images" />
      ) : (
        <div className="flex flex-col gap-4 p-4">
          <div
            aria-hidden="true"
            className="flex h-3 gap-0.5 overflow-hidden rounded-sm"
          >
            {SERVICE_STATUSES.map((item) =>
              counts[item.status] > 0 ? (
                <span
                  key={item.status}
                  className={item.dot}
                  style={{ flexGrow: counts[item.status] }}
                />
              ) : null,
            )}
          </div>
          <dl className="flex flex-col gap-2 text-xs">
            {SERVICE_STATUSES.filter(
              (item) => item.status !== 'pending' || counts.pending > 0,
            ).map((item) => (
              <div key={item.status} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-[2px]', item.dot)}
                />
                <dt
                  className="min-w-0 truncate text-fg-primary"
                  title={`${item.label}: ${item.hint}`}
                >
                  {item.label}
                  <span className="ml-1.5 text-fg-tertiary">{item.hint}</span>
                </dt>
                <dd
                  className={cn(
                    'ml-auto font-mono tabular-nums',
                    counts[item.status] > 0 && item.text
                      ? item.text
                      : 'text-fg-secondary',
                  )}
                >
                  {counts[item.status]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Panel>
  );
};

/** Findings of the project's images by severity, each bar against the largest. */
export const SeverityPanel = ({
  totals,
  fixable,
}: {
  totals: VulnerabilityCounts;
  /** Findings with a fixed version. */
  fixable: number;
}) => {
  const total = totalOf(totals);
  const largest = Math.max(...SEVERITIES.map((severity) => totals[severity]));

  return (
    <Panel
      title="Findings by severity"
      hint={`${total} in all`}
      wellClassName="min-h-56"
      footer={
        total > 0 ? (
          <p className="text-[11px] text-fg-tertiary tabular-nums">
            {fixable} of {total} have a fixed version
          </p>
        ) : null
      }
    >
      {total === 0 ? (
        <EmptyWell label="No known vulnerabilities" />
      ) : (
        <dl className="flex flex-col gap-3 p-4 text-xs">
          {SEVERITIES.filter(
            (severity) => severity !== 'unknown' || totals.unknown > 0,
          ).map((severity) => (
            <div
              key={severity}
              className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3"
            >
              <dt className="text-fg-secondary">{SEVERITY_LABEL[severity]}</dt>
              <dd
                aria-hidden="true"
                className="h-2 rounded-full bg-surface-muted"
              >
                <span
                  className={cn(
                    'block h-full rounded-full',
                    SEVERITY_BAR[severity],
                  )}
                  style={{
                    width: `${largest ? (totals[severity] / largest) * 100 : 0}%`,
                  }}
                />
              </dd>
              <dd className="text-right font-mono text-fg-primary tabular-nums">
                {totals[severity]}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
};
