import type { ReactNode } from 'react';
import type { StorageBenchmarkTest } from '@acceleratio/shared';
import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  formatLatency,
  formatMegabytes,
  formatNumber,
  latencyNote,
  testVerdict,
} from '../utils/benchmark-report';
import { formatChange, formatMbps } from '../utils/storage-class-form';
import { BenchmarkChart } from './benchmark-chart';

type BenchmarkTestCardProps = {
  label: string;
  /** Null while the test has not finished. */
  test: StorageBenchmarkTest | null;
  state: 'done' | 'running' | 'waiting' | 'failed' | 'skipped';
  /** Same test in the previous run of this profile. */
  previous?: Omit<StorageBenchmarkTest, 'series'> | null;
};

const Metric = ({
  label,
  value,
  change,
}: {
  label: string;
  value: ReactNode;
  change?: string | null;
}) => (
  <div className="min-w-0">
    <dt className="text-[12px] text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 text-sm font-medium text-foreground tabular-nums">
      {value}
      {change ? (
        <span
          className={cn(
            'ml-1.5 text-[12px] font-normal',
            change.startsWith('-')
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
          title="Compared with the previous run of this profile"
        >
          {change}
        </span>
      ) : null}
    </dd>
  </div>
);

const STATE_TEXT: Record<
  Exclude<BenchmarkTestCardProps['state'], 'done'>,
  string
> = {
  running: 'Running now…',
  waiting: 'Waiting for the previous test',
  failed: 'This test failed',
  skipped: 'Not run: an earlier step failed',
};

export const BenchmarkTestCard = ({
  label,
  test,
  state,
  previous,
}: BenchmarkTestCardProps) => {
  if (!test) {
    return (
      <section aria-label={label} className="panel-lit rounded-lg px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-foreground">{label}</h3>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[12px]',
              state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {state === 'running' ? (
              <LoaderCircle
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {state === 'done' ? '' : STATE_TEXT[state]}
          </span>
        </div>
      </section>
    );
  }

  const verdict = testVerdict(test);
  const note = latencyNote(test);
  const isRandom = test.pattern === 'random';
  const primary = isRandom
    ? {
        title: 'IOPS',
        points: test.series.map((point) => ({ t: point.t, value: point.iops })),
        format: (value: number) => `${formatNumber(value)} IOPS`,
      }
    : {
        title: 'Throughput',
        points: test.series.map((point) => ({ t: point.t, value: point.mbps })),
        format: (value: number) => `${formatMbps(value)} MB/s`,
      };
  const latencyPoints = test.series
    .filter((point) => point.latency_ms > 0)
    .map((point) => ({ t: point.t, value: point.latency_ms }));

  return (
    <section aria-label={label} className="panel-lit rounded-lg">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{test.label}</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {test.parameters.block_size} blocks · {test.parameters.jobs}{' '}
            {test.parameters.jobs === 1 ? 'job' : 'parallel jobs'} ·{' '}
            {test.parameters.io_depth !== undefined
              ? `${test.parameters.io_depth} in flight per job · `
              : null}
            {test.parameters.engine},{' '}
            {test.parameters.direct ? 'direct' : 'buffered'} I/O ·{' '}
            {test.parameters.file_size} file · {test.parameters.limit}
          </p>
        </div>
        <p className="flex max-w-md items-start gap-1.5 text-[13px] text-fg-secondary">
          {test.error_code === 0 ? (
            <CheckCircle2
              aria-hidden="true"
              strokeWidth={1.75}
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
          ) : (
            <AlertTriangle
              aria-hidden="true"
              strokeWidth={1.75}
              className="mt-0.5 size-3.5 shrink-0 text-status-warning"
            />
          )}
          {verdict.text}
        </p>
      </header>

      <div className="px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {isRandom ? (
            <Metric
              label="IOPS"
              value={formatNumber(test.iops)}
              change={formatChange(test.iops, previous?.iops)}
            />
          ) : (
            <Metric
              label="Throughput"
              value={`${formatMbps(test.bandwidth_mbps)} MB/s`}
              change={formatChange(
                test.bandwidth_mbps,
                previous?.bandwidth_mbps,
              )}
            />
          )}
          {isRandom ? (
            <Metric
              label="Throughput"
              value={`${formatMbps(test.bandwidth_mbps)} MB/s`}
            />
          ) : (
            <Metric label="IOPS" value={formatNumber(test.iops)} />
          )}
          <Metric
            label="Average latency"
            value={formatLatency(test.latency_ms.mean)}
          />
          <Metric
            label="Ran for"
            value={`${test.runtime_seconds} s · ${formatMegabytes(test.io_mb)}`}
          />
        </dl>

        <div className="mt-4 rounded-md bg-surface-muted px-3 py-2.5">
          <p className="text-[12px] font-medium text-fg-secondary">
            Latency distribution
          </p>
          <dl className="mt-1.5 grid grid-cols-3 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-5">
            {(
              [
                ['Median', test.latency_ms.p50],
                ['95%', test.latency_ms.p95],
                ['99%', test.latency_ms.p99],
                ['99.9%', test.latency_ms.p999],
                ['Slowest', test.latency_ms.max],
              ] as const
            ).map(([name, value]) => (
              <div key={name}>
                <dt className="text-[12px] text-muted-foreground">{name}</dt>
                <dd className="text-foreground tabular-nums">
                  {formatLatency(value)}
                </dd>
              </div>
            ))}
          </dl>
          {note ? (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-fg-secondary">
              {note.steady ? null : (
                <AlertTriangle
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mt-0.5 size-3 shrink-0 text-status-warning"
                />
              )}
              {note.text}
            </p>
          ) : null}
          {test.error_code !== 0 ? (
            <p className="mt-2 text-[12px] text-destructive">
              fio reported error {test.error_code} during this test.
            </p>
          ) : null}
        </div>

        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <BenchmarkChart
            title={primary.title}
            points={primary.points}
            format={primary.format}
          />
          <BenchmarkChart
            title="Latency"
            points={latencyPoints}
            format={formatLatency}
          />
        </div>

        {test.series.length > 0 ? (
          <details className="group mt-4">
            <summary className="cursor-pointer text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
              Show the data per second
            </summary>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-left text-[12px] tabular-nums">
                <thead className="sticky top-0 bg-surface-raised text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 font-medium">
                      Second
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-medium">
                      IOPS
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-medium">
                      MB/s
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-medium">
                      Latency
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {test.series.map((point) => (
                    <tr key={point.t}>
                      <td className="px-3 py-1">{point.t}</td>
                      <td className="px-3 py-1">{formatNumber(point.iops)}</td>
                      <td className="px-3 py-1">{formatMbps(point.mbps)}</td>
                      <td className="px-3 py-1">
                        {point.latency_ms > 0
                          ? formatLatency(point.latency_ms)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
};
