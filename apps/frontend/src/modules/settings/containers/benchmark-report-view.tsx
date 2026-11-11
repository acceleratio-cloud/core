'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Gauge, LoaderCircle } from 'lucide-react';
import { sileo } from 'sileo';

import type {
  StorageBenchmarkReport,
  StorageBenchmarkTestName,
  StorageClass,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { storageClassesApi } from '@/api/storage-classes';
import { cn } from '@/lib/utils';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { BenchmarkTestCard } from '../components/benchmark-test-card';
import { settingsSectionHref } from '../sections';
import {
  formatLatency,
  stepLabel,
  TEST_ORDER,
} from '../utils/benchmark-report';
import {
  formatChange,
  formatDuration,
  formatIops,
  formatMbps,
  profileSummary,
} from '../utils/storage-class-form';

const POLL_MS = 4000;
export const STORAGE_SETTINGS_HREF = settingsSectionHref('storage');

const isActive = (report: StorageBenchmarkReport) =>
  report.status === 'pending' || report.status === 'running';

type TestState = 'done' | 'running' | 'waiting' | 'failed' | 'skipped';

const testState = (
  report: StorageBenchmarkReport,
  name: StorageBenchmarkTestName,
): TestState => {
  if (report.tests.some((test) => test.name === name)) {
    return 'done';
  }

  if (isActive(report)) {
    return report.progress?.current_test === name ? 'running' : 'waiting';
  }

  return report.failed_step === name ? 'failed' : 'skipped';
};

const Tile = ({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: string | null;
}) => (
  <div className="panel-lit rounded-lg px-4 py-3">
    <p className="text-[12px] text-muted-foreground">{label}</p>
    <p className="mt-1 text-xl font-medium tracking-tight text-foreground tabular-nums">
      {value}
    </p>
    <p
      className={cn(
        'mt-0.5 h-4 text-[12px]',
        change?.startsWith('-') ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {change ? `${change} vs previous run` : ''}
    </p>
  </div>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4 py-2 text-[13px]">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right text-foreground">{value}</dd>
  </div>
);

export const BenchmarkReportView = ({ id }: { id: string }) => {
  const router = useRouter();
  const [report, setReport] = useState<StorageBenchmarkReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const active = report ? isActive(report) : false;

  useEffect(() => {
    let mounted = true;

    storageClassesApi
      .benchmarkReport(id)
      .then((next) => {
        if (mounted) {
          setReport(next);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (mounted) {
          setError(getApiErrorMessage(loadError));
        }
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  // A running benchmark reports each finished test; follow it until it ends.
  useEffect(() => {
    if (!active) {
      return;
    }

    let mounted = true;
    const timer = setInterval(() => {
      storageClassesApi
        .benchmarkReport(id)
        .then((next) => {
          if (mounted) {
            setReport(next);
          }
        })
        .catch(() => undefined);
    }, POLL_MS);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [active, id]);

  const runAgain = async () => {
    if (!report?.storage_class_id) {
      return;
    }

    setIsStarting(true);

    try {
      const next = await storageClassesApi.startBenchmark(
        report.storage_class_id,
      );

      router.push(`/settings/storage/benchmarks/${next.id}`);
    } catch (startError) {
      sileo.error({
        title: 'Could not start the benchmark',
        description: getApiErrorMessage(startError),
      });
    } finally {
      setIsStarting(false);
    }
  };

  const back = (
    <Link
      href={STORAGE_SETTINGS_HREF}
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}
    >
      <ArrowLeft
        aria-hidden="true"
        strokeWidth={1.75}
        data-icon="inline-start"
      />
      Storage settings
    </Link>
  );

  if (error && !report) {
    return (
      <div>
        {back}
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  if (!report) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading the benchmark report</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const previous = report.previous;
  const results = report.results;
  const started = report.started_at ?? report.created_at;
  const duration = formatDuration(report.started_at, report.finished_at);
  const completed = report.progress?.completed ?? report.tests.length;
  const total = report.progress?.total ?? TEST_ORDER.length;
  const snapshot = report.profile_snapshot;

  return (
    <div>
      {back}

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
            Benchmark of {report.storage_class_name}
          </h1>
          <p className="mt-2.5 text-sm text-muted-foreground">
            {active
              ? 'Running'
              : report.status === 'succeeded'
                ? 'Succeeded'
                : 'Failed'}{' '}
            · started{' '}
            <time dateTime={started} title={formatAbsoluteTime(started)}>
              {formatRelativeTime(started)}
            </time>
            {duration ? ` · took ${duration}` : ''}
            {report.storage_class_id === null ? ' · profile deleted' : ''}
          </p>
        </div>
        {report.storage_class_id ? (
          <Button
            type="button"
            variant="outline"
            loading={isStarting}
            disabled={active}
            onClick={runAgain}
          >
            <Gauge
              aria-hidden="true"
              strokeWidth={1.75}
              data-icon="inline-start"
            />
            Run again
          </Button>
        ) : null}
      </div>

      {active ? (
        <section
          aria-label="Progress"
          role="status"
          className="mt-6 panel-lit rounded-lg px-5 py-4"
        >
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <LoaderCircle
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              {report.progress?.current_test
                ? `${stepLabel(report.progress.current_test)} running`
                : completed === 0
                  ? 'Preparing the test volume and installing fio'
                  : 'Collecting results'}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {completed} of {total} tests done
            </span>
          </div>
          <div aria-hidden="true" className="mt-3 grid h-2 grid-cols-4 gap-0.5">
            {TEST_ORDER.map((test, index) => (
              <span
                key={test.name}
                className={cn(
                  'rounded-full',
                  index < completed
                    ? 'bg-brand-fg'
                    : report.progress?.current_test === test.name
                      ? 'bg-brand-fg/40 motion-safe:animate-pulse'
                      : 'bg-surface-muted',
                )}
              />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Each finished test appears below as soon as it is done. A run takes
            about 2 minutes.
          </p>
        </section>
      ) : null}

      {report.status === 'failed' ? (
        <section
          aria-label="Failure"
          className="mt-6 rounded-lg border border-status-danger/40 bg-status-danger/10 px-5 py-4"
        >
          <p className="text-sm font-medium text-destructive">
            Failed
            {report.failed_step
              ? ` while ${stepLabel(report.failed_step).toLowerCase()}`
              : ''}
          </p>
          {report.status_message ? (
            <p className="mt-1 text-[13px] text-fg-secondary">
              {report.status_message}
            </p>
          ) : null}
          {completed > 0 ? (
            <p className="mt-1 text-[12px] text-muted-foreground">
              Tests that finished before the failure are shown below.
            </p>
          ) : null}
        </section>
      ) : null}

      {results ? (
        <section aria-label="Summary" className="mt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Random read"
              value={`${formatIops(results.random_read_iops)} IOPS`}
              change={formatChange(
                results.random_read_iops,
                previous?.results?.random_read_iops,
              )}
            />
            <Tile
              label="Random write"
              value={`${formatIops(results.random_write_iops)} IOPS`}
              change={formatChange(
                results.random_write_iops,
                previous?.results?.random_write_iops,
              )}
            />
            <Tile
              label="Sequential read"
              value={`${formatMbps(results.sequential_read_mbps)} MB/s`}
              change={formatChange(
                results.sequential_read_mbps,
                previous?.results?.sequential_read_mbps,
              )}
            />
            <Tile
              label="Sequential write"
              value={`${formatMbps(results.sequential_write_mbps)} MB/s`}
              change={formatChange(
                results.sequential_write_mbps,
                previous?.results?.sequential_write_mbps,
              )}
            />
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Average latency: {formatLatency(results.random_read_latency_ms)} per
            small read, {formatLatency(results.random_write_latency_ms)} per
            small write.
            {previous ? (
              <>
                {' '}
                Compared with the run{' '}
                <Link
                  href={`/settings/storage/benchmarks/${previous.id}`}
                  className="text-brand-fg underline-offset-4 hover:underline"
                >
                  {formatRelativeTime(previous.created_at)}
                </Link>
                .
              </>
            ) : (
              ' This is the first successful run of this profile.'
            )}
          </p>
        </section>
      ) : null}

      <div className="mt-6 flex flex-col gap-4">
        {TEST_ORDER.map(({ name, label }) => (
          <BenchmarkTestCard
            key={name}
            label={label}
            test={report.tests.find((test) => test.name === name) ?? null}
            state={testState(report, name)}
            previous={
              previous?.tests.find((test) => test.name === name) ?? null
            }
          />
        ))}
        {report.tests.length === 0 && !active && report.status !== 'failed' ? (
          <p className="text-[13px] text-muted-foreground">
            This run was recorded before per-test reports existed.
          </p>
        ) : null}
      </div>

      <section aria-label="Context" className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="panel-lit rounded-lg px-5 py-4">
          <h2 className="text-sm font-medium text-foreground">
            Profile at run time
          </h2>
          {snapshot ? (
            <dl className="mt-2 divide-y divide-border">
              <Row
                label="Settings"
                value={profileSummary({
                  parameters: snapshot.parameters,
                  reclaim_policy: snapshot.reclaim_policy,
                } as StorageClass).join(' · ')}
              />
              <Row
                label="Volumes can grow"
                value={snapshot.allow_volume_expansion ? 'Yes' : 'No'}
              />
              <Row
                label="Kubernetes StorageClass"
                value={snapshot.external_name}
              />
            </dl>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Not recorded for this run.
            </p>
          )}
        </div>
        <div className="panel-lit rounded-lg px-5 py-4">
          <h2 className="text-sm font-medium text-foreground">How it ran</h2>
          <dl className="mt-2 divide-y divide-border">
            <Row label="Test volume" value="2 GiB, deleted afterwards" />
            <Row label="Tool" value="fio, buffered I/O (psync)" />
            {report.environment?.nodes != null ? (
              <Row
                label="Cluster nodes"
                value={String(report.environment.nodes)}
              />
            ) : null}
            {report.environment?.volume_servers != null ? (
              <Row
                label="Storage servers"
                value={String(report.environment.volume_servers)}
              />
            ) : null}
            {report.environment?.kubernetes_version ? (
              <Row
                label="Kubernetes"
                value={report.environment.kubernetes_version}
              />
            ) : null}
            <Row label="Started" value={formatAbsoluteTime(started)} />
          </dl>
        </div>
      </section>
    </div>
  );
};
