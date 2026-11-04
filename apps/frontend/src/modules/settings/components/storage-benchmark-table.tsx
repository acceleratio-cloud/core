import type { StorageBenchmark } from '@acceleratio/shared';
import { LoaderCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import {
  formatChange,
  formatDuration,
  formatIops,
  formatMbps,
} from '../utils/storage-class-form';

type StorageBenchmarkTableProps = {
  runs: StorageBenchmark[];
};

const profileKey = (run: StorageBenchmark) =>
  run.storage_class_id ?? `deleted:${run.storage_class_name}`;

/**
 * For each succeeded run, the next older succeeded run of the same profile
 * among the loaded rows (rows are newest first).
 */
const previousRuns = (runs: StorageBenchmark[]) => {
  const previous = new Map<string, StorageBenchmark>();

  runs.forEach((run, index) => {
    if (run.status !== 'succeeded' || !run.results) {
      return;
    }

    const older = runs
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.status === 'succeeded' &&
          candidate.results &&
          profileKey(candidate) === profileKey(run),
      );

    if (older) {
      previous.set(run.id, older);
    }
  });

  return previous;
};

const Change = ({ value }: { value: string | null }) =>
  value ? (
    <span
      className={cn(
        'ml-1 text-[11px]',
        value.startsWith('-') ? 'text-destructive' : 'text-muted-foreground',
      )}
      title="Compared with the previous run of this profile"
    >
      {value}
    </span>
  ) : null;

const Status = ({ run }: { run: StorageBenchmark }) => {
  if (run.status === 'pending' || run.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <LoaderCircle
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3 animate-spin motion-reduce:animate-none"
        />
        Running
      </span>
    );
  }

  if (run.status === 'succeeded') {
    return (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-status-success"
        />
        Succeeded
      </span>
    );
  }

  return (
    <span className="block max-w-56">
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-status-danger"
        />
        Failed
      </span>
      {run.status_message ? (
        <span
          title={run.status_message}
          className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground"
        >
          {run.status_message}
        </span>
      ) : null}
    </span>
  );
};

const HEADERS = [
  'Profile',
  'Status',
  'Random IOPS (read / write)',
  'Sequential MB/s (read / write)',
  'Started',
  'Duration',
];

export const StorageBenchmarkTable = ({ runs }: StorageBenchmarkTableProps) => {
  const previous = previousRuns(runs);

  return (
    <div className="-mx-6 overflow-x-auto px-6">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[12px] text-muted-foreground">
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="pr-4 pb-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {runs.map((run) => {
            const results = run.results;
            const before = previous.get(run.id)?.results ?? undefined;
            const started = run.started_at ?? run.created_at;
            const duration = formatDuration(run.started_at, run.finished_at);

            return (
              <tr key={run.id} className="align-top">
                <td className="py-2.5 pr-4">
                  <span
                    title={run.storage_class_name}
                    className="block max-w-44 truncate font-medium text-foreground"
                  >
                    {run.storage_class_name}
                  </span>
                  {run.storage_class_id === null ? (
                    <span className="text-[12px] text-muted-foreground">
                      Profile deleted
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4">
                  <Status run={run} />
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums">
                  {results ? (
                    <>
                      {formatIops(results.random_read_iops)}
                      <Change
                        value={formatChange(
                          results.random_read_iops,
                          before?.random_read_iops,
                        )}
                      />
                      <span className="text-muted-foreground"> / </span>
                      {formatIops(results.random_write_iops)}
                      <Change
                        value={formatChange(
                          results.random_write_iops,
                          before?.random_write_iops,
                        )}
                      />
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums">
                  {results ? (
                    <>
                      {formatMbps(results.sequential_read_mbps)}
                      <span className="text-muted-foreground"> / </span>
                      {formatMbps(results.sequential_write_mbps)}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap">
                  <time dateTime={started} title={formatAbsoluteTime(started)}>
                    {formatRelativeTime(started)}
                  </time>
                </td>
                <td className="py-2.5 whitespace-nowrap tabular-nums text-fg-secondary">
                  {duration ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
