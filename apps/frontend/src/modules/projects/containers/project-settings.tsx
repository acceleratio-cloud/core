'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { sileo } from 'sileo';

import { getApiErrorMessage } from '@/api';
import { projectsApi } from '@/api/projects';
import { SettingsSection } from '@/modules/settings/components/settings-section';
import { CopyButton } from '@/shared/components/copy-button';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { useProject } from '../providers/project-provider';

const NAME_MAX_LENGTH = 48;

/** The Settings tab: project identity and the danger zone. */
export const ProjectSettings = () => {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-20 pb-10 sm:px-6">
      <GeneralSection />
      <DangerSection />
    </div>
  );
};

const GeneralSection = () => {
  const { project, replaceProject } = useProject();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<{ name: string }>({ values: { name: project.name } });

  const onSubmit = handleSubmit(async ({ name }) => {
    try {
      const updated = await projectsApi.update(project.id, {
        name: name.trim(),
      });

      replaceProject(updated);
      reset({ name: updated.name });
      sileo.success({ title: 'Project renamed' });
    } catch (error) {
      setError('root', { message: getApiErrorMessage(error) });
    }
  });

  return (
    <SettingsSection
      id="project-general"
      title="General"
      description="The name shows in the project switcher and across the console."
    >
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="project-settings-name">Name</FieldLabel>
              <Input
                id="project-settings-name"
                autoComplete="off"
                maxLength={NAME_MAX_LENGTH}
                aria-invalid={!!errors.name}
                {...register('name', {
                  validate: (value) =>
                    value.trim().length > 0 || 'Give the project a name.',
                  maxLength: {
                    value: NAME_MAX_LENGTH,
                    message: `Keep the name under ${NAME_MAX_LENGTH} characters.`,
                  },
                })}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="project-settings-id">Project ID</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="project-settings-id"
                  readOnly
                  value={project.id}
                  className="font-mono text-[13px] tabular-nums"
                />
                <CopyButton value={project.id} label="Copy project ID" />
              </div>
              <FieldDescription>
                Workloads run in the namespace{' '}
                <span className="font-mono">project-{project.id}</span>.
              </FieldDescription>
            </Field>
          </div>
          <FieldError>{errors.root?.message}</FieldError>
        </FieldGroup>

        <div className="mt-6 flex items-center gap-3 border-t border-border pt-5">
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
};

const DangerSection = () => {
  const { project, workloads } = useProject();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isDeleting) {
      return;
    }

    if (!nextOpen) {
      setConfirmation('');
      setError(null);
    }

    setOpen(nextOpen);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      await projectsApi.remove(project.id);
      sileo.success({ title: `Deleted ${project.name}` });
      router.replace('/');
      router.refresh();
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError));
      setIsDeleting(false);
    }
  };

  return (
    <SettingsSection
      id="project-danger"
      title="Delete project"
      description="Deletes the project, its services and its namespace in the cluster. This cannot be undone."
      action={
        <Button
          type="button"
          variant="destructive"
          onClick={() => setOpen(true)}
        >
          Delete project
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {workloads.length === 0
          ? 'The project has no services.'
          : `${workloads.length} ${workloads.length === 1 ? 'service' : 'services'} will be removed with it.`}
      </p>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent showCloseButton={!isDeleting}>
          <DialogHeader>
            <DialogTitle>Delete {project.name}</DialogTitle>
            <DialogDescription>
              The project&apos;s namespace is deleted with every service running
              in it. Type the project name to confirm.
            </DialogDescription>
          </DialogHeader>

          <Field className="mt-4">
            <FieldLabel htmlFor="project-delete-confirmation">
              Project name
            </FieldLabel>
            <Input
              id="project-delete-confirmation"
              autoComplete="off"
              placeholder={project.name}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>

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
              disabled={confirmation.trim() !== project.name}
              onClick={handleDelete}
            >
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
};
