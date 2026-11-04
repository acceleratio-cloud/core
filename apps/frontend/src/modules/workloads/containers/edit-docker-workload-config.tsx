'use client';

import { useEffect, useId } from 'react';
import {
  ChevronsRight,
  Container,
  Cpu,
  MemoryStick,
  Package,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { useController, useForm, type Control } from 'react-hook-form';

import type { DockerWorkloadConfig } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import {
  DetailSection,
  DetailStack,
} from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  formatShellArgs,
  parseShellArgs,
} from '@/modules/workloads/utils/shell-args';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  effectiveConfig,
  formatCpu,
  formatMemory,
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
import { Slider } from '@/shared/components/ui/slider';
import { Switch } from '@/shared/components/ui/switch';
import { useWorkloadActions } from './workload-actions';

/** Slider ranges. A stored value outside them widens the range to fit. */
const CPU_RANGE = { min: 0.1, max: 8, step: 0.1 };
const RAM_RANGE = { min: 128, max: 16384, step: 128 };

interface DockerConfigForm {
  dockerImage: string;
  entrypoint: string;
  command: string;
  cpuLimited: boolean;
  cpuMax: number;
  ramLimited: boolean;
  ramMax: number;
}

/** Absent limits show the default; null limits show the switch off. */
const toForm = (config: DockerWorkloadConfig): DockerConfigForm => ({
  dockerImage: config.docker_image,
  entrypoint: formatShellArgs(config.entrypoint),
  command: formatShellArgs(config.command),
  cpuLimited: config.cpu_max !== null,
  cpuMax: config.cpu_max ?? DEFAULT_CPU_MAX,
  ramLimited: config.ram_max !== null,
  ramMax: config.ram_max ?? DEFAULT_RAM_MAX,
});

/**
 * A limit left at the default on a config that never set one stays absent,
 * so opening and saving the form does not create a pending change.
 */
const limitValue = (
  limited: boolean,
  value: number,
  stored: number | null | undefined,
  fallback: number,
): number | null | undefined => {
  if (!limited) {
    return null;
  }

  return stored === undefined && value === fallback ? undefined : value;
};

const toConfig = (
  form: DockerConfigForm,
  stored: DockerWorkloadConfig,
): DockerWorkloadConfig => {
  const config: DockerWorkloadConfig = { docker_image: form.dockerImage.trim() };
  const entrypoint = parseShellArgs(form.entrypoint);
  const command = parseShellArgs(form.command);
  const cpuMax = limitValue(
    form.cpuLimited,
    form.cpuMax,
    stored.cpu_max,
    DEFAULT_CPU_MAX,
  );
  const ramMax = limitValue(
    form.ramLimited,
    form.ramMax,
    stored.ram_max,
    DEFAULT_RAM_MAX,
  );

  if (entrypoint.length > 0) {
    config.entrypoint = entrypoint;
  }

  if (command.length > 0) {
    config.command = command;
  }

  if (cpuMax !== undefined) {
    config.cpu_max = cpuMax;
  }

  if (ramMax !== undefined) {
    config.ram_max = ramMax;
  }

  return config;
};

const validateArgs = (value: string) => {
  try {
    parseShellArgs(value);
    return true;
  } catch (parseError) {
    return (parseError as Error).message;
  }
};

/** An input with a leading icon. */
const IconInput = ({
  icon: Icon,
  ...props
}: React.ComponentProps<typeof Input> & { icon: LucideIcon }) => (
  <div className="relative">
    <Icon
      aria-hidden="true"
      strokeWidth={1.75}
      className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-tertiary"
    />
    <Input {...props} className={cn('pl-8', props.className)} />
  </div>
);

/**
 * One resource: a switch that turns the limit on or off and, while on, a
 * slider for its value.
 */
const LimitField = ({
  control,
  icon: Icon,
  label,
  limitedName,
  valueName,
  range,
  format,
  disabled,
}: {
  control: Control<DockerConfigForm>;
  icon: LucideIcon;
  label: string;
  limitedName: 'cpuLimited' | 'ramLimited';
  valueName: 'cpuMax' | 'ramMax';
  range: { min: number; max: number; step: number };
  format: (value: number) => string;
  disabled: boolean;
}) => {
  const labelId = useId();
  const switchId = useId();
  const { field: limited } = useController({ control, name: limitedName });
  const { field: value } = useController({ control, name: valueName });

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-4 text-fg-tertiary"
        />
        <span id={labelId} className="text-sm font-medium text-fg-primary">
          {label}
        </span>
        <span className="ml-auto text-xs text-fg-secondary tabular-nums">
          {limited.value ? format(value.value) : 'No limit'}
        </span>
        <label htmlFor={switchId} className="sr-only">
          {`Limit ${label.toLowerCase()}`}
        </label>
        <Switch
          id={switchId}
          checked={limited.value}
          onCheckedChange={limited.onChange}
          disabled={disabled}
        />
      </div>

      {limited.value ? (
        <Slider
          aria-labelledby={labelId}
          value={value.value}
          min={Math.min(range.min, value.value)}
          max={Math.max(range.max, value.value)}
          step={range.step}
          disabled={disabled}
          onValueChange={(next) => {
            const number = Array.isArray(next) ? next[0] : next;
            // Steps of 0.1 drift in binary floating point.
            value.onChange(Math.round(number * 1000) / 1000);
          }}
        />
      ) : (
        <p className="text-xs leading-relaxed text-fg-tertiary">
          The container can use as much as the node has free.
        </p>
      )}
    </div>
  );
};

/**
 * Edits the image, process, and resource limits of a Docker service. Saving
 * stores a draft; the header's Deploy applies it as a new version.
 */
export const EditDockerWorkloadConfig = () => {
  const { workload, pendingAction, saveConfig } = useWorkloadActions();
  const config = effectiveConfig(workload);
  const configKey = JSON.stringify(config);

  const {
    register,
    control,
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
    const next = toConfig(values, config);

    try {
      await saveConfig(next);
      reset(toForm(next));
    } catch (saveError) {
      setError('root', { message: (saveError as Error).message });
    }
  });

  const isSaving = isSubmitting || pendingAction === 'save';
  const isLocked = pendingAction !== null;
  const isDeployed = workload.active_version !== null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <DetailStack>
        <DetailSection title="Container" icon={Package}>
          <FieldGroup className="gap-4 px-3 py-3">
            <Field data-invalid={errors.dockerImage ? true : undefined}>
              <FieldLabel htmlFor="workload-config-image">Image</FieldLabel>
              <IconInput
                icon={Container}
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

            <Field data-invalid={errors.entrypoint ? true : undefined}>
              <FieldLabel htmlFor="workload-config-entrypoint">
                Entrypoint
              </FieldLabel>
              <IconInput
                icon={ChevronsRight}
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
              <IconInput
                icon={SquareTerminal}
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
          </FieldGroup>
        </DetailSection>

        <DetailSection title="Resources" icon={Cpu}>
          <div className="divide-y divide-edge-subtle">
            <LimitField
              control={control}
              icon={Cpu}
              label="CPU"
              limitedName="cpuLimited"
              valueName="cpuMax"
              range={CPU_RANGE}
              format={formatCpu}
              disabled={isLocked}
            />
            <LimitField
              control={control}
              icon={MemoryStick}
              label="Memory"
              limitedName="ramLimited"
              valueName="ramMax"
              range={RAM_RANGE}
              format={formatMemory}
              disabled={isLocked}
            />
          </div>
        </DetailSection>

        <div className="flex flex-col gap-2">
          <FieldError>{errors.root?.message}</FieldError>
          <div className="flex items-center gap-3">
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
              disabled={!isDirty || isLocked}
            >
              {isSaving ? 'Saving' : 'Save changes'}
            </Button>
          </div>
        </div>
      </DetailStack>
    </form>
  );
};
