'use client';

import { useMemo, useState } from 'react';
import { Activity, CloudOff, RefreshCw } from 'lucide-react';

import type { MetricsRange, ProjectMetrics } from '@acceleratio/shared';
import { useProject } from '@/modules/projects/providers/project-provider';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { DonutPanel, type DonutSlice } from '../components/donut-panel';
import { GaugePanel } from '../components/gauge-panel';
import { PanelRow } from '../components/panel-row';
import { RangePicker } from '../components/range-picker';
import { ServicesTable } from '../components/services-table';
import { StatPanel } from '../components/stat-panel';
import { TimeseriesPanel } from '../components/timeseries-panel';
import { useProjectMetrics } from '../hooks/use-project-metrics';
import {
  formatByteRate,
  formatBytes,
  formatCores,
  type ValueFormatter,
} from '../utils/format';
import {
  assignSeriesTones,
  OTHER_SERIES_KEY,
  toServiceSeries,
} from '../utils/series';

/**
 * The Observability tab: resource usage of the project's services from
 * VictoriaMetrics. It only polls while `active`, so a hidden tab costs
 * nothing.
 */
export const ObservabilityView = ({ active }: { active: boolean }) => {
  const { project } = useProject();
  const [range, setRange] = useState<MetricsRange>('1h');
  const { data, error, isLoading, updatedAt, refresh } = useProjectMetrics(
    project.id,
    range,
    active,
  );

  let body;

  if (data) {
    body = <Dashboard metrics={data} />;
  } else if (error?.unavailable) {
    body = <UnavailableState message={error.message} onRetry={refresh} />;
  } else if (error) {
    body = (
      <MessageState
        icon={
          <CloudOff aria-hidden="true" strokeWidth={1.75} className="size-5" />
        }
        title="Could not load metrics"
        message={error.message}
        onRetry={refresh}
      />
    );
  } else {
    body = <DashboardSkeleton />;
  }

  return (
    <div className="flex flex-col gap-3 px-3 pb-10">
      <div className="pointer-events-none z-20 flex justify-end pt-16 md:sticky md:top-0 md:pt-3">
        <div className="pointer-events-auto">
          <RangePicker
            range={range}
            onRangeChange={setRange}
            isLoading={isLoading}
            updatedAt={data ? updatedAt : null}
            onRefresh={() => void refresh()}
          />
        </div>
      </div>

      {data && error ? (
        <p
          role="status"
          className="self-start rounded-md border border-status-warning/30 bg-surface-raised px-3 py-1.5 text-xs text-status-warning"
        >
          Showing the last good data. {error.message}
        </p>
      ) : null}

      <div aria-busy={isLoading} className="flex flex-col gap-4">
        <span className="sr-only">
          {isLoading ? 'Loading metrics' : 'Metrics loaded'}
        </span>
        {body}
      </div>
    </div>
  );
};

const ratioOf = (value: number | null, reference: number | null | undefined) =>
  value === null || !reference ? null : value / reference;

/** `120m of 2 cores limit`, or against the cluster when there is no limit. */
const gaugeCaption = (
  value: number | null,
  limit: number | null,
  cluster: number | undefined,
  format: ValueFormatter,
) => {
  if (value === null) {
    return 'No samples yet';
  }

  if (limit) {
    return `${format(value)} of ${format(limit)} limit`;
  }

  return cluster
    ? `${format(value)} of ${format(cluster)} cluster`
    : format(value);
};

const Dashboard = ({ metrics }: { metrics: ProjectMetrics }) => {
  const { summary, series, cluster, workloads } = metrics;

  const tones = useMemo(
    () => assignSeriesTones(workloads.map((workload) => workload.workload_id)),
    [workloads],
  );

  const charts = useMemo(
    () => ({
      cpu: toServiceSeries(series.cpu_cores, tones),
      memory: toServiceSeries(series.memory_bytes, tones),
      rx: toServiceSeries(series.network_rx_bytes_per_second, tones),
      tx: toServiceSeries(series.network_tx_bytes_per_second, tones),
      read: toServiceSeries(series.disk_read_bytes_per_second, tones),
      write: toServiceSeries(series.disk_write_bytes_per_second, tones),
    }),
    [series, tones],
  );

  const memorySlices = useMemo(() => {
    const slices: DonutSlice[] = [];
    let other = 0;

    for (const workload of workloads) {
      const tone = tones.get(workload.workload_id);
      const value = workload.memory_bytes ?? 0;

      if (tone) {
        slices.push({
          key: workload.workload_id,
          label: workload.name,
          tone,
          value,
        });
      } else {
        other += value;
      }
    }

    if (other > 0) {
      slices.push({
        key: OTHER_SERIES_KEY,
        label: 'Other',
        tone: 'other',
        value: other,
      });
    }

    return slices;
  }, [workloads, tones]);

  if (workloads.length === 0) {
    return (
      <MessageState
        icon={
          <Activity aria-hidden="true" strokeWidth={1.75} className="size-5" />
        }
        title="No services yet"
        message="Deploy a service from the Overview tab and its CPU, memory, network and disk usage will show here."
      />
    );
  }

  const timeWindow = {
    range: metrics.range,
    start: metrics.start,
    end: metrics.end,
  };
  const cpuLimit = summary.cpu_limit_cores;
  const memoryLimit = summary.memory_limit_bytes;

  return (
    <>
      <PanelRow
        title="Summary"
        panelCount={6}
        className="grid-cols-2 md:grid-cols-3 2xl:grid-cols-6"
      >
        <StatPanel
          title="CPU"
          value={
            summary.cpu_cores === null ? null : formatCores(summary.cpu_cores)
          }
          caption={cpuLimit ? `limit ${formatCores(cpuLimit)}` : 'no CPU limit'}
          points={series.cpu_cores.total}
        />
        <StatPanel
          title="Memory"
          value={
            summary.memory_bytes === null
              ? null
              : formatBytes(summary.memory_bytes)
          }
          caption={
            memoryLimit
              ? `limit ${formatBytes(memoryLimit)}`
              : 'no memory limit'
          }
          points={series.memory_bytes.total}
        />
        <StatPanel
          title="Disk"
          value={
            summary.disk_used_bytes === null
              ? null
              : formatBytes(summary.disk_used_bytes)
          }
          caption={
            summary.disk_capacity_bytes
              ? `of ${formatBytes(summary.disk_capacity_bytes)} provisioned`
              : 'no volumes'
          }
        />
        <StatPanel
          title="Network in"
          value={
            summary.network_rx_bytes_per_second === null
              ? null
              : formatByteRate(summary.network_rx_bytes_per_second)
          }
          caption="received"
          points={series.network_rx_bytes_per_second.total}
        />
        <StatPanel
          title="Network out"
          value={
            summary.network_tx_bytes_per_second === null
              ? null
              : formatByteRate(summary.network_tx_bytes_per_second)
          }
          caption="sent"
          points={series.network_tx_bytes_per_second.total}
        />
        <StatPanel
          title="Pods ready"
          value={`${summary.pods_ready}/${summary.pods_total}`}
          caption={`${summary.restarts} ${summary.restarts === 1 ? 'restart' : 'restarts'}`}
        />
      </PanelRow>

      <PanelRow title="Saturation" panelCount={3} className="md:grid-cols-3">
        <GaugePanel
          title="CPU"
          ratio={ratioOf(summary.cpu_cores, cpuLimit ?? cluster?.cpu_cores)}
          caption={gaugeCaption(
            summary.cpu_cores,
            cpuLimit,
            cluster?.cpu_cores,
            formatCores,
          )}
        />
        <GaugePanel
          title="Memory"
          ratio={ratioOf(
            summary.memory_bytes,
            memoryLimit ?? cluster?.memory_bytes,
          )}
          caption={gaugeCaption(
            summary.memory_bytes,
            memoryLimit,
            cluster?.memory_bytes,
            formatBytes,
          )}
        />
        <GaugePanel
          title="Disk"
          ratio={ratioOf(summary.disk_used_bytes, summary.disk_capacity_bytes)}
          caption={
            summary.disk_capacity_bytes
              ? `${formatBytes(summary.disk_used_bytes ?? 0)} of ${formatBytes(summary.disk_capacity_bytes)}`
              : 'No volumes in this project'
          }
        />
      </PanelRow>

      <PanelRow title="Compute" panelCount={2} className="lg:grid-cols-2">
        <TimeseriesPanel
          title="CPU"
          hint="cores · by service"
          series={charts.cpu}
          format={formatCores}
          {...timeWindow}
        />
        <TimeseriesPanel
          title="Memory"
          hint="working set · by service"
          series={charts.memory}
          format={formatBytes}
          {...timeWindow}
        />
      </PanelRow>

      <PanelRow title="Network" panelCount={2} className="lg:grid-cols-2">
        <TimeseriesPanel
          title="Received"
          hint="bytes/s · by service"
          series={charts.rx}
          format={formatByteRate}
          {...timeWindow}
        />
        <TimeseriesPanel
          title="Sent"
          hint="bytes/s · by service"
          series={charts.tx}
          format={formatByteRate}
          {...timeWindow}
        />
      </PanelRow>

      <PanelRow title="Disk I/O" panelCount={2} className="lg:grid-cols-2">
        <TimeseriesPanel
          title="Reads"
          hint="bytes/s · by service"
          series={charts.read}
          format={formatByteRate}
          {...timeWindow}
        />
        <TimeseriesPanel
          title="Writes"
          hint="bytes/s · by service"
          series={charts.write}
          format={formatByteRate}
          {...timeWindow}
        />
      </PanelRow>

      <PanelRow title="Services" panelCount={2} className="xl:grid-cols-3">
        <DonutPanel
          title="Memory share"
          hint="now"
          slices={memorySlices}
          format={formatBytes}
        />
        <ServicesTable
          workloads={workloads}
          tones={tones}
          className="xl:col-span-2"
        />
      </PanelRow>
    </>
  );
};

const DashboardSkeleton = () => (
  <div className="flex flex-col gap-4" aria-hidden="true">
    <Skeleton className="h-4 w-32" />
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-38 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-4 w-28" />
    <div className="grid gap-3 md:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-62 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-4 w-28" />
    <div className="grid gap-3 lg:grid-cols-2">
      {Array.from({ length: 2 }, (_, index) => (
        <Skeleton key={index} className="h-80 rounded-xl" />
      ))}
    </div>
  </div>
);

const MessageState = ({
  icon,
  title,
  message,
  onRetry,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  onRetry?: () => void;
  children?: React.ReactNode;
}) => (
  <div className="mx-auto mt-10 flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border border-edge-default bg-surface-raised px-6 py-10 text-center">
    <span className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-fg-secondary">
      {icon}
    </span>
    <h2 className="text-base font-medium tracking-tight text-fg-primary">
      {title}
    </h2>
    <p className="text-sm text-fg-secondary">{message}</p>
    {children}
    {onRetry ? (
      <Button
        type="button"
        variant="outline"
        onClick={onRetry}
        className="mt-1"
      >
        <RefreshCw aria-hidden="true" strokeWidth={1.75} />
        Try again
      </Button>
    ) : null}
  </div>
);

const UnavailableState = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) => (
  <MessageState
    icon={<CloudOff aria-hidden="true" strokeWidth={1.75} className="size-5" />}
    title="Metrics backend unavailable"
    message={message}
    onRetry={onRetry}
  >
    <div className="w-full rounded-lg border border-edge-subtle bg-surface-sunken p-3 text-left text-xs text-fg-secondary">
      <p>
        Observability reads from VictoriaMetrics in the{' '}
        <span className="font-mono">victoria-metrics</span> namespace. Install
        it with:
      </p>
      <ul className="mt-2 flex flex-col gap-1 font-mono text-fg-primary">
        <li>make cluster-up</li>
        <li>sudo ./deploy/install.sh</li>
      </ul>
    </div>
  </MessageState>
);
