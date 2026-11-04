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

type ControlPlaneApplyDialogProps = {
  url: string | null;
  fallbackUrl: string | null;
  onOpenChange: (open: boolean) => void;
  onApply: () => Promise<void>;
};

export const ControlPlaneApplyDialog = ({
  url,
  fallbackUrl,
  onOpenChange,
  onApply,
}: ControlPlaneApplyDialogProps) => {
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setError(null);
    }

    onOpenChange(open);
  };

  const handleApply = async () => {
    setIsApplying(true);
    setError(null);

    try {
      await onApply();
      handleOpenChange(false);
    } catch (applyError) {
      setError(getApiErrorMessage(applyError));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={url !== null} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!isApplying}>
        <DialogHeader>
          <DialogTitle>Apply URL change</DialogTitle>
          <DialogDescription>
            The console moves to {url} once its HTTPS certificate is issued,
            which usually takes under a minute. You will be redirected and asked
            to sign in again there.
            {fallbackUrl ? ` ${fallbackUrl} keeps working as a fallback.` : ''}
          </DialogDescription>
        </DialogHeader>

        <FieldError className="mt-4">{error}</FieldError>

        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" />}
            disabled={isApplying}
          >
            Cancel
          </DialogClose>
          <Button type="button" loading={isApplying} onClick={handleApply}>
            Apply URL change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
