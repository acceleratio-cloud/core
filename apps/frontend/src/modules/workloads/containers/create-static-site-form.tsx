'use client';

import { ArrowLeft } from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import {
  GeneratedNameInput,
  generateName,
} from '@/shared/components/generated-name-input';
import { Button } from '@/shared/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/shared/components/ui/field';

/** Only the name: files are uploaded from the site's Overview after it exists. */
export const CreateStaticSiteForm = ({
  projectId,
  onCreated,
  onBack,
}: {
  projectId: string;
  onCreated: (workload: Workload) => void;
  onBack: () => void;
}) => {
  const {
    register,
    setValue,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ name: string }>({
    defaultValues: { name: generateName() },
  });

  const onSubmit = handleSubmit(async ({ name }) => {
    clearErrors('root');

    try {
      onCreated(
        await workloadsApi.create(projectId, {
          name: name.trim(),
          type: 'static',
        }),
      );
    } catch (createError) {
      setError('root', { message: getApiErrorMessage(createError) });
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create static site</DialogTitle>
        <DialogDescription>
          Serves the files you upload over HTTPS on its domains. Upload the site
          from its Overview once it is created.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup className="mt-5">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="static-site-name">Name</FieldLabel>
            <GeneratedNameInput
              id="static-site-name"
              onGenerate={(generated) =>
                setValue('name', generated, {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              autoComplete="off"
              spellCheck={false}
              maxLength={255}
              autoFocus
              aria-invalid={!!errors.name}
              {...register('name', {
                validate: (value) => value.trim() !== '' || 'Enter a name',
              })}
            />
            <FieldError errors={[errors.name]} />
          </Field>

          <FieldError>{errors.root?.message}</FieldError>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create site'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};
