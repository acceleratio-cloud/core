'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { PostgresVersion, Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import {
  ProfileField,
  SIZE_ERROR,
  SizeField,
  parseSize,
} from './workload-volume-dialogs';
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
import { DEFAULT_VOLUME_SIZE } from '../utils/workload-config';

/** Mirrors `POSTGRES_VERSIONS` in the shared package, newest first. */
const VERSIONS: PostgresVersion[] = ['17', '16'];

interface PostgresForm {
  name: string;
  // Only carries the size error; the value lives in `sizeText`.
  size_gb: string;
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
  const [sizeText, setSizeText] = useState(String(DEFAULT_VOLUME_SIZE));
  const [profileId, setProfileId] = useState<string | null>(null);
  // Generated once per opened form, not on every render.
  const [initialName] = useState(generateName);
  const {
    register,
    setValue,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PostgresForm>({
    defaultValues: { name: initialName },
  });

  const onSubmit = handleSubmit(async ({ name }) => {
    clearErrors();

    const size = parseSize(sizeText);

    if (size === null) {
      setError('size_gb', { message: SIZE_ERROR });
      return;
    }

    try {
      const workload = await workloadsApi.create(projectId, {
        name: name.trim(),
        type: 'postgres',
        config: {
          postgres_version: version,
          size_gb: size,
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
            <GeneratedNameInput
              id="postgres-name"
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

          <SizeField
            text={sizeText}
            onTextChange={setSizeText}
            error={errors.size_gb?.message ?? null}
          />

          <ProfileField
            profiles={profiles}
            value={profileId}
            onChange={setProfileId}
          />

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
