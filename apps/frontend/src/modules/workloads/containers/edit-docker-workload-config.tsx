'use client';

import { useEffect } from 'react';
import { Package } from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { DockerWorkloadConfig } from '@acceleratio/shared';
import { DetailSection } from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  formatShellArgs,
  parseShellArgs,
} from '@/modules/workloads/utils/shell-args';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  effectiveConfig,
} from '@/modules/workloads/utils/workload-config';
import { Button } from '@/shared/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { useWorkloadActions } from './workload-actions';

const CPU_MIN = 0.01;
const CPU_MAX = 64;
const RAM_MIN = 16;
const RAM_MAX = 262144;

interface DockerConfigForm {
  dockerImage: string;
  cpuMax: string;
  ramMax: string;
  entrypoint: string;
  command: string;
}

const toForm = (config: DockerWorkloadConfig): DockerConfigForm => ({
  dockerImage: config.docker_image,
  cpuMax: config.cpu_max === undefined ? '' : String(config.cpu_max),
  ramMax: config.ram_max === undefined ? '' : String(config.ram_max),
  entrypoint: formatShellArgs(config.entrypoint),
  command: formatShellArgs(config.command),
});

/** Blank fields mean "use the default", so they are left out of the config. */
const toConfig = (form: DockerConfigForm): DockerWorkloadConfig => {
  const config: DockerWorkloadConfig = { docker_image: form.dockerImage.trim() };
  const entrypoint = parseShellArgs(form.entrypoint);
  const command = parseShellArgs(form.command);

  if (form.cpuMax.trim()) {
    config.cpu_max = Number(form.cpuMax);
  }

  if (form.ramMax.trim()) {
    config.ram_max = Number(form.ramMax);
  }

  if (entrypoint.length > 0) {
    config.entrypoint = entrypoint;
  }

  if (command.length > 0) {
    config.command = command;
  }

  return config;
};

const validateRange =
  (min: number, max: number, unit: string, integer: boolean) =>
  (value: string) => {
    if (!value.trim()) {
      return true;
    }

    const number = Number(value);

    if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) {
      return integer ? `Enter a whole number of ${unit}.` : 'Enter a number.';
    }

    return number >= min && number <= max
      ? true
      : `Use ${min} to ${max} ${unit}.`;
  };

const validateArgs = (value: string) => {
  try {
    parseShellArgs(value);
    return true;
  } catch (parseError) {
    return (parseError as Error).message;
  }
};

/**
 * Edits the image, limits, entrypoint and command of a Docker service. Saving
 * stores a draft; the header's Deploy applies it as a new version.
 */
export const EditDockerWorkloadConfig = () => {
  const { workload, pendingAction, saveConfig } = useWorkloadActions();
  const config = effectiveConfig(workload);
  const configKey = JSON.stringify(config);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<DockerConfigForm>({ defaultValues: toForm(config) });

  // Follow rollbacks, discarded drafts and edits from another tab, but never
  // overwrite what the user is typing.
  useEffect(() => {
    if (!isDirty) {
      reset(toForm(JSON.parse(configKey) as DockerWorkloadConfig));
    }
    // `isDirty` is read, not tracked: a save resets the form itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, reset]);

  const onSubmit = handleSubmit(async (values) => {
    clearErrors('root');
    const next = toConfig(values);

    try {
      await saveConfig(next);
      reset(toForm(next));
    } catch (saveError) {
      setError('root', { message: (saveError as Error).message });
    }
  });

  const isSaving = isSubmitting || pendingAction === 'save';
  const isDeployed = workload.active_version !== null;

  return (
    <DetailSection title="Container" icon={Package}>
      <form onSubmit={onSubmit} noValidate className="px-3 py-3">
        <FieldGroup className="gap-4">
          <Field data-invalid={errors.dockerImage ? true : undefined}>
            <FieldLabel htmlFor="workload-config-image">Image</FieldLabel>
            <Input
              id="workload-config-image"
              autoComplete="off"
              spellCheck={false}
              placeholder="nginx:latest"
              aria-invalid={!!errors.dockerImage}
              className="font-mono"
              {...register('dockerImage', {
                validate: (value) =>
                  value.trim() ? true : 'Enter the image to run.',
              })}
            />
            <FieldError errors={[errors.dockerImage]} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field data-invalid={errors.cpuMax ? true : undefined}>
              <FieldLabel htmlFor="workload-config-cpu">
                CPU limit (vCPU)
              </FieldLabel>
              <Input
                id="workload-config-cpu"
                type="number"
                inputMode="decimal"
                step="any"
                min={CPU_MIN}
                max={CPU_MAX}
                placeholder={String(DEFAULT_CPU_MAX)}
                aria-invalid={!!errors.cpuMax}
                {...register('cpuMax', {
                  validate: validateRange(CPU_MIN, CPU_MAX, 'vCPU', false),
                })}
              />
              <FieldError errors={[errors.cpuMax]} />
            </Field>

            <Field data-invalid={errors.ramMax ? true : undefined}>
              <FieldLabel htmlFor="workload-config-ram">
                Memory limit (MiB)
              </FieldLabel>
              <Input
                id="workload-config-ram"
                type="number"
                inputMode="numeric"
                step={1}
                min={RAM_MIN}
                max={RAM_MAX}
                placeholder={String(DEFAULT_RAM_MAX)}
                aria-invalid={!!errors.ramMax}
                {...register('ramMax', {
                  validate: validateRange(RAM_MIN, RAM_MAX, 'MiB', true),
                })}
              />
              <FieldError errors={[errors.ramMax]} />
            </Field>
          </div>

          <Field data-invalid={errors.entrypoint ? true : undefined}>
            <FieldLabel htmlFor="workload-config-entrypoint">
              Entrypoint
            </FieldLabel>
            <Input
              id="workload-config-entrypoint"
              autoComplete="off"
              spellCheck={false}
              placeholder="Image default"
              aria-invalid={!!errors.entrypoint}
              className="font-mono"
              {...register('entrypoint', { validate: validateArgs })}
            />
            <FieldError errors={[errors.entrypoint]} />
          </Field>

          <Field data-invalid={errors.command ? true : undefined}>
            <FieldLabel htmlFor="workload-config-command">Command</FieldLabel>
            <Input
              id="workload-config-command"
              autoComplete="off"
              spellCheck={false}
              placeholder="Image default"
              aria-invalid={!!errors.command}
              className="font-mono"
              {...register('command', { validate: validateArgs })}
            />
            <FieldDescription className="text-xs">
              Split like a shell line: quote arguments that contain spaces.
            </FieldDescription>
            <FieldError errors={[errors.command]} />
          </Field>

          <FieldError>{errors.root?.message}</FieldError>
        </FieldGroup>

        <div className="mt-4 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-tertiary">
            {isDeployed
              ? 'Saved changes apply on the next deploy.'
              : 'Changes apply when the service is deployed.'}
          </p>
          {isDirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSaving}
              onClick={() => reset(toForm(config))}
            >
              Reset
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            loading={isSaving}
            disabled={!isDirty || pendingAction !== null}
          >
            {isSaving ? 'Saving' : 'Save changes'}
          </Button>
        </div>
      </form>
    </DetailSection>
  );
};
