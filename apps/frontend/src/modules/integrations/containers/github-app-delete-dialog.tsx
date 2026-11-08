'use client';

import { useState } from 'react';

import type { GithubApp } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { githubApi } from '@/api/github';
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

type GithubAppDeleteDialogProps = {
  app: GithubApp | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
};

export const GithubAppDeleteDialog = ({
  app,
  onOpenChange,
  onDeleted,
}: GithubAppDeleteDialogProps) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!app) return;
    setIsDeleting(true);
    setError(null);

    try {
      await githubApi.remove(app.id);
      onDeleted();
      onOpenChange(false);
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!isDeleting}>
        <DialogHeader>
          <DialogTitle>Remove GitHub App</DialogTitle>
          <DialogDescription>
            Remove {app?.name} from Acceleratio? Its keys are deleted here. The
            App stays on github.com until you delete it there.
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
            Remove App
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
