'use client';

import { useEffect, useState } from 'react';

import type { StorageBenchmark, StorageClass } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { storageClassesApi } from '@/api/storage-classes';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { SettingsSection } from '../components/settings-section';
import { StorageBenchmarkTable } from '../components/storage-benchmark-table';

type StorageBenchmarkHistoryProps = {
  /** Current profiles, for the filter. */
  profiles: StorageClass[];
  /** Changes when a benchmark starts, so the new run shows up at once. */
  refreshKey: number;
};

const ALL_PROFILES = 'all';
const PAGE_SIZE = 25;
/** The API caps a page at 100 rows. */
const MAX_PAGE = 100;
const POLL_MS = 5000;

const isActive = (run: StorageBenchmark) =>
  run.status === 'pending' || run.status === 'running';

export const StorageBenchmarkHistory = ({
  profiles,
  refreshKey,
}: StorageBenchmarkHistoryProps) => {
  const [filter, setFilter] = useState(ALL_PROFILES);
  const [runs, setRuns] = useState<StorageBenchmark[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasActive = runs.some(isActive);
  const storageClassId = filter === ALL_PROFILES ? undefined : filter;
  // Re-reads keep the rows already loaded, up to the API page cap.
  const loadedCount = Math.min(Math.max(runs.length, PAGE_SIZE), MAX_PAGE);

  useEffect(() => {
    let active = true;

    storageClassesApi
      .benchmarkHistory({ storage_class_id: storageClassId, limit: PAGE_SIZE })
      .then((page) => {
        if (active) {
          setRuns(page.items);
          setNextBefore(page.next_before);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(getApiErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [storageClassId, refreshKey]);

  // Running rows finish in the background; re-read the newest rows until
  // nothing is running.
  useEffect(() => {
    if (!hasActive) {
      return;
    }

    let active = true;
    const timer = setInterval(() => {
      storageClassesApi
        .benchmarkHistory({
          storage_class_id: storageClassId,
          limit: loadedCount,
        })
        .then((page) => {
          if (active) {
            setRuns(page.items);
            setNextBefore(page.next_before);
          }
        })
        .catch(() => undefined);
    }, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [hasActive, storageClassId, loadedCount]);

  const loadMore = async () => {
    if (!nextBefore) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const page = await storageClassesApi.benchmarkHistory({
        storage_class_id: storageClassId,
        before: nextBefore,
        limit: PAGE_SIZE,
      });

      setRuns((current) => [...current, ...page.items]);
      setNextBefore(page.next_before);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoadingMore(false);
    }
  };

  const filterChoices = [
    { value: ALL_PROFILES, label: 'All profiles' },
    ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
  ];

  return (
    <SettingsSection
      id="storage-benchmarks"
      title="Benchmarks"
      description="Every benchmark run, newest first. Changes are compared with the previous run of the same profile."
      action={
        <Select
          value={filter}
          items={filterChoices}
          onValueChange={(value) => {
            if (typeof value === 'string') {
              setIsLoading(true);
              setFilter(value);
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="Filter by profile"
            className="w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {filterChoices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {isLoading ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading benchmark history</span>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : error && runs.length === 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : runs.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {storageClassId
            ? 'This profile has not been benchmarked yet.'
            : 'No benchmarks yet. Run one from a storage profile above.'}
        </p>
      ) : (
        <>
          <StorageBenchmarkTable runs={runs} />
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {nextBefore ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={isLoadingMore}
                onClick={loadMore}
              >
                Show older runs
              </Button>
            </div>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
};
