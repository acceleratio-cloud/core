import { ArrowUpRight } from 'lucide-react';
import type {
  ServiceSecurity,
  VulnerabilityCounts,
  Workload,
} from '@acceleratio/shared';

import { cn } from '@/lib/utils';
import {
  SERVICE_STATUSES,
  SeverityMix,
  statusMeta,
  totalOf,
} from './security-panels';
import { ServiceIcon } from './service-icon';

export type ServiceRow = {
  service: ServiceSecurity;
  workload: Workload | undefined;
  /** Findings of its images; null until one was scanned. */
  counts: VulnerabilityCounts | null;
  actions: number;
  urgent: number;
};

const order = (row: ServiceRow) =>
  SERVICE_STATUSES.findIndex((item) => item.status === row.service.status);

/** Every service with its state, exposure and findings, most pressing first. */
export const ServiceTable = ({
  rows,
  onOpen,
}: {
  rows: ServiceRow[];
  onOpen: (workloadId: string) => void;
}) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[760px] text-[13px]">
      <caption className="sr-only">Security of each service</caption>
      <thead className="text-left text-[12px] text-fg-tertiary">
        <tr className="border-b border-edge-subtle">
          <th scope="col" className="px-3 py-2 font-medium">
            Service
          </th>
          <th scope="col" className="w-52 px-3 py-2 font-medium">
            Status
          </th>
          <th scope="col" className="w-24 px-3 py-2 font-medium">
            Exposure
          </th>
          <th scope="col" className="w-44 px-3 py-2 font-medium">
            Findings
          </th>
          <th scope="col" className="w-20 px-3 py-2 text-right font-medium">
            Critical
          </th>
          <th scope="col" className="w-20 px-3 py-2 text-right font-medium">
            High
          </th>
          <th scope="col" className="w-20 px-3 py-2 text-right font-medium">
            Actions
          </th>
          <th scope="col" className="w-12 px-3 py-2">
            <span className="sr-only">Open</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-edge-subtle">
        {[...rows]
          .sort((a, b) => order(a) - order(b))
          .map((row) => {
            const meta = statusMeta(row.service.status);
            const name = row.workload?.name ?? 'Service';

            return (
              <tr
                key={row.service.workload_id}
                onClick={() => onOpen(row.service.workload_id)}
                className="cursor-pointer transition-colors hover:bg-surface-muted/40"
              >
                <td className="max-w-0 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-fg-primary">
                    <ServiceIcon workload={row.workload} />
                    <span className="truncate">{name}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      'inline-flex items-center gap-2',
                      meta.text ?? 'text-fg-secondary',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-2 shrink-0 rounded-full', meta.dot)}
                    />
                    {meta.label}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-fg-secondary">
                  {row.service.public ? 'Public' : 'Internal'}
                </td>
                <td className="px-3 py-2.5">
                  {row.counts ? (
                    <span className="flex items-center gap-2">
                      <SeverityMix counts={row.counts} className="w-24" />
                      <span className="font-mono text-xs text-fg-secondary tabular-nums">
                        {totalOf(row.counts)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-fg-tertiary">—</span>
                  )}
                </td>
                <Count
                  value={row.counts?.critical}
                  className="text-status-danger"
                />
                <Count
                  value={row.counts?.high}
                  className="text-status-warning"
                />
                <Count
                  value={row.actions}
                  className={row.urgent ? 'text-status-danger' : undefined}
                />
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    aria-label={`Open ${name}`}
                    onClick={(event) => {
                      // The row's own handler would open it a second time.
                      event.stopPropagation();
                      onOpen(row.service.workload_id);
                    }}
                    className="inline-flex size-6 items-center justify-center rounded-md text-fg-tertiary outline-none hover:bg-surface-muted hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-foreground/60"
                  >
                    <ArrowUpRight
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-3.5"
                    />
                  </button>
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  </div>
);

const Count = ({
  value,
  className,
}: {
  value: number | undefined;
  className?: string;
}) => (
  <td
    className={cn(
      'px-3 py-2.5 text-right font-mono text-xs tabular-nums',
      value ? cn('font-medium text-fg-primary', className) : 'text-fg-disabled',
    )}
  >
    {value ?? '—'}
  </td>
);
