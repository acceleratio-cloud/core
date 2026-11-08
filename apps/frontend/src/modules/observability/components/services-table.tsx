import type { WorkloadMetrics } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { ViewLogsLink } from '@/modules/logs/components/view-logs-link';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { isContainerWorkload } from '@/modules/workloads/utils/workload-capabilities';
import {
  formatByteRate,
  formatBytes,
  formatCores,
  formatPercent,
  type ValueFormatter,
} from '../utils/format';
import { TONE_BG, type ChartTone } from '../utils/series';
import { Panel } from './panel';

type ServicesTableProps = {
  projectId: string;
  workloads: WorkloadMetrics[];
  tones: Map<string, ChartTone>;
  className?: string;
};

/** Every service with its current usage against its limits. */
export const ServicesTable = ({
  projectId,
  workloads,
  tones,
  className,
}: ServicesTableProps) => (
  <Panel
    title="Services"
    hint="now"
    className={className}
    wellClassName="overflow-x-auto"
  >
    <table className="w-full min-w-[640px] text-xs">
      <thead>
        <tr className="border-b border-edge-subtle text-left text-[11px] text-fg-tertiary">
          <th scope="col" className="px-3 py-2 font-medium">
            Service
          </th>
          <th scope="col" className="px-3 py-2 text-right font-medium">
            Pods
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            CPU
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Memory
          </th>
          <th scope="col" className="px-3 py-2 text-right font-medium">
            Net in / out
          </th>
          <th scope="col" className="px-3 py-2 text-right font-medium">
            Restarts
          </th>
        </tr>
      </thead>
      <tbody>
        {workloads.map((workload) => (
          <tr
            key={workload.workload_id}
            className="group/service border-b border-edge-subtle transition-colors last:border-b-0 hover:bg-surface-raised"
          >
            <th scope="row" className="px-3 py-2.5 text-left font-normal">
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-3.5 w-0.5 shrink-0 rounded-full',
                    TONE_BG[tones.get(workload.workload_id) ?? 'other'],
                  )}
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-1">
                    <span
                      className="max-w-48 truncate font-medium text-fg-primary"
                      title={workload.name}
                    >
                      {workload.name}
                    </span>
                    {isContainerWorkload(workload.type) ? (
                      <ViewLogsLink
                        variant="icon"
                        projectId={projectId}
                        service={workload.workload_id}
                        label={`View logs of ${workload.name}`}
                        className="size-6 opacity-0 transition-opacity group-hover/service:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
                      />
                    ) : null}
                  </span>
                  <WorkloadStatus status={workload.status} compact />
                </span>
              </span>
            </th>
            <td className="px-3 py-2.5 text-right font-mono text-fg-primary tabular-nums">
              {isContainerWorkload(workload.type)
                ? `${workload.pods_ready}/${workload.pods_total}`
                : '—'}
            </td>
            <td className="px-3 py-2.5">
              <Usage
                value={workload.cpu_cores}
                limit={workload.cpu_limit_cores}
                format={formatCores}
              />
            </td>
            <td className="px-3 py-2.5">
              <Usage
                value={workload.memory_bytes}
                limit={workload.memory_limit_bytes}
                format={formatBytes}
              />
            </td>
            <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap text-fg-secondary tabular-nums">
              {workload.network_rx_bytes_per_second === null &&
              workload.network_tx_bytes_per_second === null
                ? '—'
                : `${formatByteRate(workload.network_rx_bytes_per_second ?? 0)} / ${formatByteRate(workload.network_tx_bytes_per_second ?? 0)}`}
            </td>
            <td
              className={cn(
                'px-3 py-2.5 text-right font-mono tabular-nums',
                workload.restarts > 0
                  ? 'text-status-warning'
                  : 'text-fg-tertiary',
              )}
            >
              {workload.restarts}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </Panel>
);

/** A value, and when there is a limit, a thin meter of the share used. */
const Usage = ({
  value,
  limit,
  format,
}: {
  value: number | null;
  limit: number | null;
  format: ValueFormatter;
}) => {
  if (value === null) {
    return <span className="font-mono text-fg-tertiary">—</span>;
  }

  const ratio = limit ? Math.min(value / limit, 1) : null;

  return (
    <span className="flex min-w-32 flex-col gap-1">
      <span className="font-mono whitespace-nowrap text-fg-primary tabular-nums">
        {format(value)}
        <span className="text-fg-tertiary">
          {limit ? ` / ${format(limit)}` : ' · no limit'}
        </span>
      </span>
      {ratio !== null ? (
        <svg
          role="img"
          aria-label={`${formatPercent(ratio)} of limit`}
          viewBox="0 0 100 4"
          preserveAspectRatio="none"
          className="h-1 w-full max-w-36"
        >
          <rect width="100" height="4" rx="2" fill="var(--surface-muted)" />
          <rect
            width={Math.max(ratio * 100, 2)}
            height="4"
            rx="2"
            fill={
              ratio >= 0.9
                ? 'var(--status-danger)'
                : ratio >= 0.7
                  ? 'var(--status-warning)'
                  : 'var(--fg-secondary)'
            }
          />
        </svg>
      ) : null}
    </span>
  );
};
