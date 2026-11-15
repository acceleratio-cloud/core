'use client';

import { useState } from 'react';

import type { StorageClass } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { FieldError } from '@/shared/components/ui/field';

type StorageBenchmarkDialogProps = {
  storageClass: StorageClass | null;
  onOpenChange: (open: boolean) => void;
  onStart: (storageClass: StorageClass) => Promise<void>;
};

const STEPS = [
  'Creates a temporary 2 GiB volume with this profile.',
  'Runs fio for about 2 minutes: large sequential reads and writes, then small (4 KiB) random reads and writes.',
  'Deletes the volume and its data afterwards, even for profiles that keep data.',
];

export const StorageBenchmarkDialog = ({
  storageClass,
  onOpenChange,
  onStart,
}: StorageBenchmarkDialogProps) => {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setError(null);
    }

    onOpenChange(open);
  };

  const handleStart = async () => {
    if (!storageClass) {
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      await onStart(storageClass);
      handleOpenChange(false);
    } catch (startError) {
      setError(getApiErrorMessage(startError));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Dialog open={storageClass !== null} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!isStarting}>
        <DialogHeader>
          <DialogTitle>Benchmark {storageClass?.name}</DialogTitle>
          <DialogDescription>
            Measures how fast volumes with this profile read and write.
          </DialogDescription>
        </DialogHeader>

        <ol className="mt-5 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-fg-secondary">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <p className="mt-4 text-[13px] text-fg-secondary">
          The test puts real load on the cluster&apos;s storage servers, so
          other workloads may slow down while it runs. The cluster needs
          internet access to download fio. Only one benchmark runs at a time.
        </p>

        <FieldError className="mt-4">{error}</FieldError>

        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" />}
            disabled={isStarting}
          >
            Cancel
          </DialogClose>
          <Button type="button" loading={isStarting} onClick={handleStart}>
            Start benchmark
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
