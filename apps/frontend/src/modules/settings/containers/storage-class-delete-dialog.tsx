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

type StorageClassDeleteDialogProps = {
  storageClass: StorageClass | null;
  onOpenChange: (open: boolean) => void;
  onDelete: (storageClass: StorageClass) => Promise<void>;
};

export const StorageClassDeleteDialog = ({
  storageClass,
  onOpenChange,
  onDelete,
}: StorageClassDeleteDialogProps) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setError(null);
    }

    onOpenChange(open);
  };

  const handleDelete = async () => {
    if (!storageClass) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await onDelete(storageClass);
      handleOpenChange(false);
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={storageClass !== null} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!isDeleting}>
        <DialogHeader>
          <DialogTitle>Delete storage class</DialogTitle>
          <DialogDescription>
            Delete {storageClass?.name}? Its StorageClass is removed from the
            cluster. A class that volumes still use cannot be deleted.
          </DialogDescription>
        </DialogHeader>

        <FieldError className="mt-4">{error}</FieldError>

        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" />}
            disabled={isDeleting}
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            loading={isDeleting}
            onClick={handleDelete}
          >
            Delete class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
