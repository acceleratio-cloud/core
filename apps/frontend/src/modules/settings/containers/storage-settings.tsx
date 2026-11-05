'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { sileo } from 'sileo';

import type { StorageClass, StorageEnvironment } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { storageClassesApi } from '@/api/storage-classes';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { SettingsSection } from '../components/settings-section';
import { StorageClassRow } from '../components/storage-class-row';
import {
  toCreatePayload,
  type StorageClassDialogMode,
  type StorageClassForm,
} from '../utils/storage-class-form';
import { StorageBenchmarkDialog } from './storage-benchmark-dialog';
import { StorageClassDeleteDialog } from './storage-class-delete-dialog';
import { StorageClassDialog } from './storage-class-dialog';

type DialogState = {
  open: boolean;
  mode: StorageClassDialogMode;
  storageClass: StorageClass | null;
};

const CLOSED: DialogState = { open: false, mode: 'create', storageClass: null };
/** How often the list is re-read while a benchmark runs. */
const BENCHMARK_POLL_MS = 5000;

const isBenchmarkActive = (storageClass: StorageClass) =>
  storageClass.latest_benchmark?.status === 'pending' ||
  storageClass.latest_benchmark?.status === 'running';

type StorageSettingsProps = {
  /** Called after a benchmark starts, so the history can show it. */
  onBenchmarkStarted?: () => void;
  /** Called whenever the profile list changes (filter options elsewhere). */
  onProfilesChange?: (profiles: StorageClass[]) => void;
};

export const StorageSettings = ({
  onBenchmarkStarted,
  onProfilesChange,
}: StorageSettingsProps = {}) => {
  const [classes, setClasses] = useState<StorageClass[]>([]);
  const [environment, setEnvironment] = useState<StorageEnvironment | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [deleting, setDeleting] = useState<StorageClass | null>(null);
  const [benchmarking, setBenchmarking] = useState<StorageClass | null>(null);
  const benchmarkBusy = classes.some(isBenchmarkActive);

  useEffect(() => {
    onProfilesChange?.(classes);
  }, [classes, onProfilesChange]);

  const load = useCallback(async () => {
    const [list, env] = await Promise.all([
      storageClassesApi.list(),
      // The environment only drives hints; the list still renders without it.
      storageClassesApi.environment().catch(() => null),
    ]);

    return { list, env };
  }, []);

  useEffect(() => {
    let active = true;

    load()
      .then(({ list, env }) => {
        if (active) {
          setClasses(list);
          setEnvironment(env);
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
  }, [load]);

  // A running benchmark finishes in the background; re-read the list until
  // it has a result. Only runs while a benchmark is active.
  useEffect(() => {
    if (!benchmarkBusy) {
      return;
    }

    let active = true;
    const timer = setInterval(() => {
      storageClassesApi
        .list()
        .then((list) => {
          if (!active) {
            return;
          }

          setClasses(list);

          for (const item of list) {
            const before = classes.find((current) => current.id === item.id);

            if (
              before &&
              isBenchmarkActive(before) &&
              !isBenchmarkActive(item) &&
              item.latest_benchmark
            ) {
              if (item.latest_benchmark.status === 'succeeded') {
                sileo.success({ title: `Benchmark of ${item.name} finished` });
              } else {
                sileo.error({
                  title: `Benchmark of ${item.name} failed`,
                  description:
                    item.latest_benchmark.status_message ?? undefined,
                });
              }
            }
          }
        })
        .catch(() => undefined);
    }, BENCHMARK_POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [benchmarkBusy, classes]);

  const retry = () => {
    setError(null);
    setIsLoading(true);
    load()
      .then(({ list, env }) => {
        setClasses(list);
        setEnvironment(env);
      })
      .catch((loadError) => setError(getApiErrorMessage(loadError)))
      .finally(() => setIsLoading(false));
  };

  const openDialog = (
    mode: StorageClassDialogMode,
    storageClass: StorageClass | null = null,
  ) => setDialog({ open: true, mode, storageClass });

  const handleSubmit = async (form: StorageClassForm) => {
    if (dialog.mode === 'edit' && dialog.storageClass) {
      const updated = await storageClassesApi.update(dialog.storageClass.id, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        allow_volume_expansion: form.allow_volume_expansion,
      });

      setClasses((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      sileo.success({ title: 'Storage profile saved' });
      return;
    }

    const created = await storageClassesApi.create(toCreatePayload(form));

    setClasses((current) => [...current, created]);
    sileo.success({ title: 'Storage profile created' });
  };

  const handleDelete = async (storageClass: StorageClass) => {
    await storageClassesApi.remove(storageClass.id);
    setClasses((current) =>
      current.filter((item) => item.id !== storageClass.id),
    );
    sileo.success({ title: 'Storage profile deleted' });
  };

  const handleBenchmark = async (storageClass: StorageClass) => {
    const benchmark = await storageClassesApi.startBenchmark(storageClass.id);

    setClasses((current) =>
      current.map((item) =>
        item.id === storageClass.id
          ? { ...item, latest_benchmark: benchmark }
          : item,
      ),
    );
    onBenchmarkStarted?.();
  };

  return (
    <SettingsSection
      id="storage"
      title="Storage profiles"
      description="Choose how volumes and buckets keep their data: how many copies, on which disks, and for how long."
      action={
        <Button type="button" size="sm" onClick={() => openDialog('create')}>
          <Plus
            aria-hidden="true"
            strokeWidth={1.75}
            data-icon="inline-start"
          />
          New profile
        </Button>
      }
    >
      {environment?.csi_driver_installed === false ? (
        <p
          role="status"
          className="mb-5 rounded-md border border-border bg-surface-muted px-3 py-2.5 text-[13px] text-fg-secondary"
        >
          The SeaweedFS CSI driver is not installed in this cluster. Profiles
          can be created, but no volumes will be provisioned from them.
        </p>
      ) : null}

      {isLoading ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Loading storage profiles</span>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {classes.map((storageClass) => (
            <StorageClassRow
              key={storageClass.id}
              storageClass={storageClass}
              benchmarkBusy={benchmarkBusy}
              onBenchmark={() => setBenchmarking(storageClass)}
              onView={() => openDialog('view', storageClass)}
              onEdit={() => openDialog('edit', storageClass)}
              onDuplicate={() => openDialog('duplicate', storageClass)}
              onDelete={() => setDeleting(storageClass)}
            />
          ))}
        </ul>
      )}

      <StorageClassDialog
        open={dialog.open}
        mode={dialog.mode}
        storageClass={dialog.storageClass}
        environment={environment}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        onSubmit={handleSubmit}
      />

      <StorageClassDeleteDialog
        storageClass={deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        onDelete={handleDelete}
      />

      <StorageBenchmarkDialog
        storageClass={benchmarking}
        onOpenChange={(open) => {
          if (!open) {
            setBenchmarking(null);
          }
        }}
        onStart={handleBenchmark}
      />
    </SettingsSection>
  );
};
