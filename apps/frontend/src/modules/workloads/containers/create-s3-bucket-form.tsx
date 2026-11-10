'use client';

import { useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { CreateWorkloadPayload, Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { useStorageProfiles } from '@/modules/workloads/hooks/use-storage-profiles';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  BUCKET_NAME_MAX_LENGTH,
  bucketNameProblem,
  describeStorageProfile,
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
  const profiles = useStorageProfiles();
  // Null keeps the platform profile, which the API resolves.
  const [profileId, setProfileId] = useState<string | null>(null);
  const {
    register,
    setValue,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<S3BucketForm>({
    defaultValues: { name: generateName() },
  });

  const available = profiles.status === 'ready' ? profiles.profiles : [];
  const platform = available.find((profile) => profile.kind === 'platform');
  const selectedId = profileId ?? platform?.id ?? null;
  const selected = available.find((profile) => profile.id === selectedId);

  const onSubmit = handleSubmit(async ({ name }) => {
    clearErrors('root');

    try {
      const payload: CreateWorkloadPayload = {
        name: name.trim(),
        type: 's3_bucket',
      };

      if (profileId) {
        payload.config = { storage_class_id: profileId };
      }

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
          An S3-compatible bucket in SeaweedFS, with its own access keys.
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

          <details className="group border-t border-border pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-foreground outline-none focus-visible:underline">
              <ChevronRight
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
              />
              Advanced settings
              <span className="truncate font-normal text-muted-foreground">
                {selected ? selected.name : 'Platform default'}
              </span>
            </summary>

            <Field className="mt-4">
              <FieldLabel htmlFor="bucket-storage-profile">
                Storage profile
              </FieldLabel>
              {profiles.status === 'error' ? (
                <FieldDescription className="text-destructive">
                  Could not load storage profiles: {profiles.message}. The
                  bucket will use the platform default.
                </FieldDescription>
              ) : (
                <>
                  <Select
                    value={selectedId}
                    items={available.map((profile) => ({
                      value: profile.id,
                      label: profile.name,
                    }))}
                    disabled={profiles.status === 'loading'}
                    onValueChange={(next) => {
                      if (typeof next === 'string') {
                        setProfileId(next === platform?.id ? null : next);
                      }
                    }}
                  >
                    <SelectTrigger id="bucket-storage-profile">
                      <SelectValue placeholder="Loading profiles…" />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {selected
                      ? describeStorageProfile(selected)
                      : 'Replication, disk type and expiry of the stored objects.'}{' '}
                    Fixed once the bucket exists.
                  </FieldDescription>
                </>
              )}
            </Field>
          </details>

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
