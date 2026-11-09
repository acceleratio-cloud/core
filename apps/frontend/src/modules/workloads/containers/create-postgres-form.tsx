'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { PostgresVersion, Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { useStorageProfiles } from '@/modules/workloads/hooks/use-storage-profiles';
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
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  DEFAULT_VOLUME_SIZE,
  VOLUME_SIZE_MAX,
  VOLUME_SIZE_MIN,
} from '../utils/workload-config';
import { describeStorageProfile } from '../utils/s3-bucket';

/** Mirrors `POSTGRES_VERSIONS` in the shared package, newest first. */
const VERSIONS: PostgresVersion[] = ['17', '16'];

interface PostgresForm {
  name: string;
  size_gb: number;
}

export const CreatePostgresForm = ({
  projectId,
  onCreated,
  onBack,
}: {
  projectId: string;
  onCreated: (workload: Workload) => void;
  onBack: () => void;
}) => {
  const profiles = useStorageProfiles();
  const [version, setVersion] = useState<PostgresVersion>(VERSIONS[0]);
  // Null keeps the platform profile, which the API resolves.
  const [profileId, setProfileId] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PostgresForm>({
    defaultValues: { name: 'postgres', size_gb: DEFAULT_VOLUME_SIZE },
  });

  const available = profiles.status === 'ready' ? profiles.profiles : [];
  const platform = available.find((profile) => profile.kind === 'platform');
  const selectedId = profileId ?? platform?.id ?? null;
  const selected = available.find((profile) => profile.id === selectedId);

  const onSubmit = handleSubmit(async ({ name, size_gb }) => {
    clearErrors('root');

    try {
      const workload = await workloadsApi.create(projectId, {
        name: name.trim(),
        type: 'postgres',
        config: {
          postgres_version: version,
          size_gb: Number(size_gb),
          storage_class_id: profileId,
        },
      });

      onCreated(workload);
    } catch (createError) {
      setError('root', { message: getApiErrorMessage(createError) });
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create PostgreSQL</DialogTitle>
        <DialogDescription>
          A single PostgreSQL instance with its data on a persistent volume.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup className="mt-5">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="postgres-name">Name</FieldLabel>
            <Input
              id="postgres-name"
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

          <Field>
            <FieldLabel htmlFor="postgres-version">Version</FieldLabel>
            <Select
              value={version}
              items={VERSIONS.map((value) => ({
                value,
                label: `PostgreSQL ${value}`,
              }))}
              onValueChange={(next) => {
                if (typeof next === 'string') {
                  setVersion(next as PostgresVersion);
                }
              }}
            >
              <SelectTrigger id="postgres-version">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERSIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    PostgreSQL {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field data-invalid={errors.size_gb ? true : undefined}>
            <FieldLabel htmlFor="postgres-size">Disk size (GiB)</FieldLabel>
            <Input
              id="postgres-size"
              type="number"
              inputMode="numeric"
              min={VOLUME_SIZE_MIN}
              max={VOLUME_SIZE_MAX}
              step={1}
              aria-invalid={!!errors.size_gb}
              aria-describedby="postgres-size-rules"
              {...register('size_gb', {
                valueAsNumber: true,
                validate: (value) =>
                  (Number.isInteger(value) &&
                    value >= VOLUME_SIZE_MIN &&
                    value <= VOLUME_SIZE_MAX) ||
                  `Enter a whole number from ${VOLUME_SIZE_MIN} to ${VOLUME_SIZE_MAX}`,
              })}
            />
            <FieldDescription id="postgres-size-rules">
              {VOLUME_SIZE_MIN}–{VOLUME_SIZE_MAX} GiB. The version, size and
              storage profile cannot change later.
            </FieldDescription>
            <FieldError errors={[errors.size_gb]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="postgres-storage-profile">
              Storage profile
            </FieldLabel>
            {profiles.status === 'error' ? (
              <FieldDescription className="text-destructive">
                Could not load storage profiles: {profiles.message}. The
                database will use the platform default.
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
                  <SelectTrigger id="postgres-storage-profile">
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
                {selected ? (
                  <FieldDescription>
                    {describeStorageProfile(selected)}
                  </FieldDescription>
                ) : null}
              </>
            )}
          </Field>

          <FieldError>{errors.root?.message}</FieldError>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create database'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};
