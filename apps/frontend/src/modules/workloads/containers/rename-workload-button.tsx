'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { useWorkloadActions } from './workload-actions';

const NAME_MAX_LENGTH = 255;

interface RenameForm {
  name: string;
}

/**
 * The service name in the panel header as a ghost button. A click opens a
 * dialog that renames the service. A rename applies at once: it is not a
 * version and needs no deploy.
 */
export const RenameWorkloadButton = () => {
  const { workload, pendingAction, renameWorkload } = useWorkloadActions();
  const [isOpen, setIsOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The panel's portal ignores pointer events, so the dialog mounts on the body.
  const bodyRef = useRef<HTMLElement | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RenameForm>({ defaultValues: { name: workload.name } });

  useEffect(() => {
    bodyRef.current = document.body;
  }, []);

  const isSaving = pendingAction === 'rename';

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSaving) {
      return;
    }

    if (nextOpen) {
      reset({ name: workload.name });
      setSubmitError(null);
    }

    setIsOpen(nextOpen);
  };

  const onSubmit = handleSubmit(async ({ name }) => {
    const trimmed = name.trim();

    if (trimmed === workload.name) {
      setIsOpen(false);
      return;
    }

    setSubmitError(null);

    try {
      await renameWorkload(trimmed);
      setIsOpen(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        title="Rename service"
        aria-label={`Rename ${workload.name}`}
        disabled={pendingAction !== null && !isSaving}
        onClick={() => handleOpenChange(true)}
        className="-ml-2 h-auto min-w-0 truncate px-2 py-0.5 text-lg leading-tight font-semibold tracking-tight"
      >
        <span className="truncate">{workload.name}</span>
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent container={bodyRef} showCloseButton={!isSaving}>
          <form onSubmit={onSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>Rename service</DialogTitle>
              <DialogDescription>
                The new name applies immediately. It is not saved in the change
                history and does not need a redeploy.
              </DialogDescription>
            </DialogHeader>

            <Field
              className="mt-5"
              data-invalid={errors.name || submitError ? true : undefined}
            >
              <FieldLabel htmlFor="rename-workload-name">Name</FieldLabel>
              <Input
                id="rename-workload-name"
                autoComplete="off"
                maxLength={NAME_MAX_LENGTH}
                autoFocus
                aria-invalid={!!errors.name || !!submitError}
                {...register('name', {
                  validate: (value) =>
                    value.trim() ? true : 'Give the service a name.',
                  maxLength: {
                    value: NAME_MAX_LENGTH,
                    message: `Keep the name under ${NAME_MAX_LENGTH} characters.`,
                  },
                })}
              />
              <FieldError
                errors={[
                  errors.name,
                  submitError ? { message: submitError } : undefined,
                ]}
              />
            </Field>

            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" loading={isSaving}>
                {isSaving ? 'Renaming' : 'Rename'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
