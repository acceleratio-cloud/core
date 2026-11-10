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
import { Input } from '@/shared/components/ui/input';

const NAME_MAX_LENGTH = 255;

interface DockerWorkloadForm {
  name: string;
  dockerImage: string;
}

export const CreateDockerWorkloadForm = ({
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
  } = useForm<DockerWorkloadForm>({
    defaultValues: { name: generateName(), dockerImage: '' },
  });

  const onSubmit = handleSubmit(async ({ name, dockerImage }) => {
    clearErrors('root');

    try {
      const workload = await workloadsApi.create(projectId, {
        name: name.trim(),
        type: 'docker',
        config: { docker_image: dockerImage.trim() },
      });

      onCreated(workload);
    } catch (createError) {
      setError('root', { message: getApiErrorMessage(createError) });
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create Docker service</DialogTitle>
        <DialogDescription>
          Run a container image in this project.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup className="mt-5">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="workload-name">Name</FieldLabel>
            <GeneratedNameInput
              id="workload-name"
              onGenerate={(generated) =>
                setValue('name', generated, {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              autoComplete="off"
              placeholder="web"
              maxLength={NAME_MAX_LENGTH}
              autoFocus
              aria-invalid={!!errors.name}
              {...register('name', {
                required: 'Give the service a name.',
                maxLength: {
                  value: NAME_MAX_LENGTH,
                  message: `Keep the name under ${NAME_MAX_LENGTH} characters.`,
                },
              })}
            />
            <FieldError errors={[errors.name]} />
          </Field>

          <Field data-invalid={errors.dockerImage ? true : undefined}>
            <FieldLabel htmlFor="workload-docker-image">
              Docker image
            </FieldLabel>
            <Input
              id="workload-docker-image"
              autoComplete="off"
              spellCheck={false}
              placeholder="nginx:latest"
              aria-invalid={!!errors.dockerImage}
              className="font-mono"
              {...register('dockerImage', {
                required: 'Enter the image to run.',
              })}
            />
            <FieldError errors={[errors.dockerImage]} />
          </Field>

          <FieldError>{errors.root?.message}</FieldError>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create service'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};
