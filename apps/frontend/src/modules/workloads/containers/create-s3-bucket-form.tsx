'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { CreateWorkloadPayload, Workload } from '@acceleratio/shared';
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/shared/components/ui/field';
import {
  BUCKET_NAME_MAX_LENGTH,
  bucketNameProblem,
} from '../utils/s3-bucket';

interface S3BucketForm {
  name: string;
}

export const CreateS3BucketForm = ({
  projectId,
  onCreated,
  onBack,
}: {
  projectId: string;
  onCreated: (workload: Workload) => void;
  onBack: () => void;
}) => {
  // Generated once per opened form, not on every render.
  const [initialName] = useState(generateName);
  const {
    register,
    setValue,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<S3BucketForm>({
    defaultValues: { name: initialName },
  });

  const onSubmit = handleSubmit(async ({ name }) => {
    clearErrors('root');

    try {
      const payload: CreateWorkloadPayload = {
        name: name.trim(),
        type: 's3_bucket',
      };
      const workload = await workloadsApi.create(projectId, payload);

      onCreated(workload);
    } catch (createError) {
      setError('root', { message: getApiErrorMessage(createError) });
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create S3 bucket</DialogTitle>
        <DialogDescription>
          An S3-compatible bucket with its own access keys.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup className="mt-5">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="bucket-name">Bucket name</FieldLabel>
            <GeneratedNameInput
              id="bucket-name"
              onGenerate={(generated) =>
                setValue('name', generated, {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="media-uploads"
              maxLength={BUCKET_NAME_MAX_LENGTH}
              autoFocus
              aria-invalid={!!errors.name}
              aria-describedby="bucket-name-rules"
              className="font-mono"
              {...register('name', {
                validate: (value) => bucketNameProblem(value) ?? true,
              })}
            />
            <FieldDescription id="bucket-name-rules">
              3–63 lowercase letters, digits and hyphens. Names are unique
              across the whole platform and cannot change later.
            </FieldDescription>
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
            {isSubmitting ? 'Creating...' : 'Create bucket'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};
