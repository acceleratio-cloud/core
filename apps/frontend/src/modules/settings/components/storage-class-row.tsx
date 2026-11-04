import type { StorageClass } from '@acceleratio/shared';
import {
  Copy,
  Eye,
  Gauge,
  LoaderCircle,
  Lock,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/modules/workloads/utils/format-time';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  CLUSTER_STATUS_LABELS,
  formatIops,
  formatMbps,
  profileSummary,
} from '../utils/storage-class-form';

type StorageClassRowProps = {
  storageClass: StorageClass;
  /** True while any benchmark runs: one at a time across the cluster. */
  benchmarkBusy: boolean;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBenchmark: () => void;
};

// Menu icons follow the console's other menus (user menu, project switcher).
const MENU_ICON = 'size-3.5 text-muted-foreground';

const usageLabel = (count: number | null) =>
  count === null
    ? null
    : count === 0
      ? 'Not used by any volume yet'
      : `Used by ${count} ${count === 1 ? 'volume' : 'volumes'}`;

const BenchmarkSummary = ({ storageClass }: { storageClass: StorageClass }) => {
  const benchmark = storageClass.latest_benchmark;

  if (!benchmark) {
    return <span>Not benchmarked</span>;
  }

  if (benchmark.status === 'pending' || benchmark.status === 'running') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5">
        <LoaderCircle
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3 animate-spin motion-reduce:animate-none"
        />
        Benchmark running, about 2 minutes
      </span>
    );
  }

  if (benchmark.status === 'failed' || !benchmark.results) {
    return (
      <span
        className="text-destructive"
        title={benchmark.status_message ?? undefined}
      >
        Last benchmark failed
        {benchmark.status_message ? `: ${benchmark.status_message}` : ''}
      </span>
    );
  }

  const results = benchmark.results;
  const when = benchmark.finished_at ?? benchmark.created_at;

  return (
    <span className="tabular-nums">
      {formatIops(results.random_read_iops)} read /{' '}
      {formatIops(results.random_write_iops)} write IOPS ·{' '}
      {formatMbps(results.sequential_read_mbps)} /{' '}
      {formatMbps(results.sequential_write_mbps)} MB/s ·{' '}
      <time dateTime={when}>{formatRelativeTime(when)}</time>
    </span>
  );
};

export const StorageClassRow = ({
  storageClass,
  benchmarkBusy,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
  onBenchmark,
}: StorageClassRowProps) => {
  const isPlatform = storageClass.kind === 'platform';
  const status = storageClass.cluster_status;
  const usage = usageLabel(storageClass.volume_count);
  const canBenchmark = status !== 'missing' && !benchmarkBusy;

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isPlatform ? (
            <Lock
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
          <p
            title={storageClass.name}
            className="truncate text-sm font-medium text-foreground"
          >
            {storageClass.name}
          </p>
          {storageClass.is_default ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] leading-none font-medium text-muted-foreground">
              Default
            </span>
          ) : null}
        </div>

        {storageClass.description ? (
          <p className="mt-1 text-[13px] text-fg-secondary">
            {storageClass.description}
          </p>
        ) : null}

        <p className="mt-1.5 text-[13px] text-foreground">
          {profileSummary(storageClass).join(' · ')}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                status === 'ready' && 'bg-status-success',
                status === 'missing' && 'bg-status-danger',
                status === 'drifted' && 'bg-status-warning',
                status === 'unknown' && 'border border-muted-foreground',
              )}
            />
            {CLUSTER_STATUS_LABELS[status]}
          </span>
          {usage ? <span className="tabular-nums">{usage}</span> : null}
          <BenchmarkSummary storageClass={storageClass} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canBenchmark}
          title={
            benchmarkBusy
              ? 'A benchmark is already running'
              : status === 'missing'
                ? 'The profile is missing from the cluster'
                : undefined
          }
          onClick={onBenchmark}
        >
          <Gauge
            aria-hidden="true"
            strokeWidth={1.75}
            data-icon="inline-start"
          />
          Run benchmark
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${storageClass.name}`}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <MoreHorizontal
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-4"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 min-w-44">
            {isPlatform ? (
              <DropdownMenuItem onClick={onView}>
                <Eye
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className={MENU_ICON}
                />
                View settings
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className={MENU_ICON}
                />
                Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={onDuplicate}
              disabled={!storageClass.parameters}
            >
              <Copy
                aria-hidden="true"
                strokeWidth={1.75}
                className={MENU_ICON}
              />
              Duplicate
            </DropdownMenuItem>
            {isPlatform ? null : (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive data-highlighted:text-destructive"
                >
                  <Trash2
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="size-3.5"
                  />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
};
