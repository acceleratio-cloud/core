'use client';

import { useState } from 'react';

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
import { formatVersion } from '../utils/platform-update';

type PlatformUpdateDialogProps = {
  /** Target version; the dialog is open while it is set. */
  version: string | null;
  currentVersion: string | null;
  onOpenChange: (open: boolean) => void;
  onUpdate: (version: string) => Promise<void>;
};

const STEPS = [
  'Downloads the installer scripts of the release and checks them against its published SHA-256 checksums.',
  'Backs up the database and takes an etcd snapshot on the server.',
  'Updates Kubernetes, the system components, the API and the console to the versions of the release, then checks they are healthy.',
  'Rolls the system components, the API and the console back to the current version if anything fails. Kubernetes itself and the database are not rolled back automatically.',
];

export const PlatformUpdateDialog = ({
  version,
  currentVersion,
  onOpenChange,
  onUpdate,
}: PlatformUpdateDialogProps) => {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setError(null);
    }

    onOpenChange(open);
  };

  const handleUpdate = async () => {
    if (!version) {
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      await onUpdate(version);
      handleOpenChange(false);
    } catch (updateError) {
      setError(getApiErrorMessage(updateError));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Dialog open={version !== null} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!isStarting}>
        <DialogHeader>
          <DialogTitle>Update to {formatVersion(version)}</DialogTitle>
          <DialogDescription>
            Updates the platform from {formatVersion(currentVersion)} on the
            server. It usually takes 5 to 15 minutes; the console and the API
            are unavailable for a short while near the end. Your services are
            not redeployed.
          </DialogDescription>
        </DialogHeader>

        <ol className="mt-4 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-muted-foreground">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <p className="mt-4 text-[13px] text-muted-foreground">
          Database migrations only move forward: a rollback restores the
          previous images, not the previous schema. The backup is kept on the
          server for a manual restore.
        </p>

        <FieldError className="mt-4">{error}</FieldError>

        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" />}
            disabled={isStarting}
          >
            Cancel
          </DialogClose>
          <Button type="button" loading={isStarting} onClick={handleUpdate}>
            Update to {formatVersion(version)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
