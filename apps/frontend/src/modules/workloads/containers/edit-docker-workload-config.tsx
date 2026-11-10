'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useController, useForm, type Control } from 'react-hook-form';

import type {
  DockerWorkloadConfig,
  GithubWorkloadConfig,
} from '@acceleratio/shared';
import {
  DetailSection,
  DetailStack,
} from '@/modules/workloads/components/workload-details/detail-primitives';
import { UnsavedChangesBanner } from '@/modules/workloads/components/workload-details/unsaved-changes-banner';
import { DockerWorkloadNetwork } from './docker-workload-network';
import { DockerWorkloadPrivateNetwork } from './docker-workload-private-network';
import { DockerWorkloadVolumes } from './docker-workload-volumes';
import { GithubBranchSelect } from './github-branch-select';
import {
  formatShellArgs,
  parseShellArgs,
} from '@/modules/workloads/utils/shell-args';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  DEFAULT_REPLICAS,
  effectiveConfig,
  formatCpu,
  formatMemory,
  formatReplicas,
  REPLICAS_MAX,
  REPLICAS_MIN,
} from '@/modules/workloads/utils/workload-config';
import { cn } from '@/lib/utils';
import { FieldError } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Slider } from '@/shared/components/ui/slider';
import { Switch } from '@/shared/components/ui/switch';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  formatSelector,
  parseLabels,
} from '@/modules/servers/utils/node-metadata';
import { ExternalLink } from 'lucide-react';

import { getApiErrorMessage } from '@/api';
import { GithubIcon } from '@/shared/icons/github-icon';
import { workloadsApi } from '@/api/workloads';
import { useProject } from '@/modules/projects/providers/project-provider';
import { useWorkloadActions } from './workload-actions';

/** Slider ranges. A stored value outside them widens the range to fit. */
const CPU_RANGE = { min: 0.1, max: 8, step: 0.1 };
const RAM_RANGE = { min: 128, max: 16384, step: 128 };

interface DockerConfigForm {
  dockerImage: string;
  /** GitHub services only; empty for Docker services. */
  branch: string;
  entrypoint: string;
  command: string;
  cpuLimited: boolean;
  cpuMax: number;
  ramLimited: boolean;
  ramMax: number;
  replicas: number;
  nodeSelector: string;
}

/** Absent limits show the default; null limits show the switch off. */
const toForm = (config: DockerWorkloadConfig): DockerConfigForm => ({
  // A GitHub service has no image until its first build.
  dockerImage: config.docker_image ?? '',
  branch: (config as Partial<GithubWorkloadConfig>).branch ?? '',
  entrypoint: formatShellArgs(config.entrypoint),
  command: formatShellArgs(config.command),
  cpuLimited: config.cpu_max !== null,
  cpuMax: config.cpu_max ?? DEFAULT_CPU_MAX,
  ramLimited: config.ram_max !== null,
  ramMax: config.ram_max ?? DEFAULT_RAM_MAX,
  replicas: config.replicas ?? DEFAULT_REPLICAS,
  nodeSelector: formatSelector(config.node_selector ?? {}),
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
  const config: DockerWorkloadConfig = {
    docker_image: form.dockerImage.trim(),
  };

  // The API keeps the App and repository; the branch is the one it takes.
  if (form.branch) {
    (config as Partial<GithubWorkloadConfig>).branch = form.branch;
  }
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

  // One replica is the default and stays absent, as the API stores it.
  if (form.replicas !== DEFAULT_REPLICAS) {
    config.replicas = form.replicas;
  }

  const nodeSelector = parseLabels(form.nodeSelector);

  if (Object.keys(nodeSelector).length > 0) {
    config.node_selector = nodeSelector;
  }

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

  // Volumes are edited in their own section and saved on their own; the
  // form carries them through unchanged.
  if (stored.volumes?.length) {
    config.volumes = stored.volumes;
  }

  // `env` is left out on purpose: the API then keeps the stored variables,
  // which are edited on the Environment tab.

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

/**
 * One setting: label and a line of help on the left, the control on the
 * right. Stacks on narrow panels.
 */
export const SettingRow = ({
  label,
  htmlFor,
  labelId,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  labelId?: string;
  hint?: ReactNode;
  children: ReactNode;
}) => (
  <div className="grid gap-x-6 gap-y-2 px-3 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
    <div className="min-w-0 sm:pt-1.5">
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="text-[13px] leading-5 font-medium text-fg-primary"
        >
          {label}
        </label>
      ) : (
        <span
          id={labelId}
          className="text-[13px] leading-5 font-medium text-fg-primary"
        >
          {label}
        </span>
      )}
      {hint ? (
        <p className="text-xs leading-5 text-fg-tertiary">{hint}</p>
      ) : null}
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

/** The current value, above its slider. */
const SliderValue = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[13px] leading-5 text-fg-primary tabular-nums">
    {children}
  </span>
);

/** Range ends under a slider, so its scale reads at a glance. */
export const SliderScale = ({ min, max }: { min: string; max: string }) => (
  <div
    aria-hidden="true"
    className="mt-1.5 flex justify-between font-mono text-[11px] leading-4 text-fg-tertiary tabular-nums"
  >
    <span>{min}</span>
    <span>{max}</span>
  </div>
);

/**
 * One resource: a switch that turns the limit on or off and, while on, a
 * slider for its value.
 */
const LimitField = ({
  control,
  label,
  hint,
  limitedName,
  valueName,
  range,
  format,
  disabled,
}: {
  control: Control<DockerConfigForm>;
  label: string;
  hint: string;
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
  const min = Math.min(range.min, value.value);
  const max = Math.max(range.max, value.value);

  return (
    <SettingRow label={label} labelId={labelId} hint={hint}>
      <div className="flex h-8 items-center gap-3">
        <label
          htmlFor={switchId}
          className={cn(
            'flex-1 font-mono text-[13px] leading-5 tabular-nums',
            limited.value ? 'text-fg-primary' : 'text-fg-tertiary',
          )}
        >
          {limited.value ? format(value.value) : 'Unlimited'}
        </label>
        <Switch
          id={switchId}
          aria-label={`Limit ${label.toLowerCase()}`}
          checked={limited.value}
          onCheckedChange={limited.onChange}
          disabled={disabled}
        />
      </div>

      {limited.value ? (
        <div className="pt-2">
          <Slider
            aria-labelledby={labelId}
            value={value.value}
            min={min}
            max={max}
            step={range.step}
            disabled={disabled}
            onValueChange={(next) => {
              const number = Array.isArray(next) ? next[0] : next;
              // Steps of 0.1 drift in binary floating point.
              value.onChange(Math.round(number * 1000) / 1000);
            }}
          />
          <SliderScale min={format(min)} max={format(max)} />
        </div>
      ) : null}
    </SettingRow>
  );
};

/** How many pods run the service: a slider over the range the API accepts. */
const ReplicasField = ({
  control,
  disabled,
}: {
  control: Control<DockerConfigForm>;
  disabled: boolean;
}) => {
  const labelId = useId();
  const { field } = useController({ control, name: 'replicas' });
  const max = Math.max(REPLICAS_MAX, field.value);

  return (
    <SettingRow label="Replicas" labelId={labelId} hint="Running copies.">
      <div className="flex h-8 items-center">
        <SliderValue>{formatReplicas(field.value)}</SliderValue>
      </div>
      <div className="pt-2">
        <Slider
          aria-labelledby={labelId}
          value={field.value}
          min={REPLICAS_MIN}
          max={max}
          step={1}
          disabled={disabled}
          onValueChange={(next) => {
            field.onChange(Math.round(Array.isArray(next) ? next[0] : next));
          }}
        />
        <SliderScale min={String(REPLICAS_MIN)} max={String(max)} />
      </div>
    </SettingRow>
  );
};

/**
 * A setting whose control is short: label and one line of help on the left,
 * the control at the right edge.
 */
const InlineRow = ({
  label,
  htmlFor,
  hint,
  children,
  footer,
}: {
  label: string;
  htmlFor: string;
  hint: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) => (
  <div className="px-3 py-3">
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={htmlFor}
          className="text-[13px] leading-5 font-medium text-fg-primary"
        >
          {label}
        </label>
        <p className="text-xs leading-5 text-fg-tertiary">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
    {footer}
  </div>
);

/** The repository a GitHub service builds, linked to github.com. */
const RepositoryHeader = ({ repository }: { repository: string }) => (
  <div className="flex items-center gap-3 px-3 py-3">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-edge-default bg-surface-sunken">
      <GithubIcon className="size-4.5 text-fg-primary" />
    </span>
    <div className="min-w-0 flex-1">
      <a
        href={`https://github.com/${repository}`}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex max-w-full items-center gap-1.5 font-mono text-[13px] leading-5 font-medium text-fg-primary underline-offset-2 hover:underline focus-visible:underline"
      >
        <span className="truncate">{repository}</span>
        <ExternalLink
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 shrink-0 text-fg-tertiary transition-colors group-hover:text-fg-secondary"
        />
        <span className="sr-only">(opens GitHub)</span>
      </a>
      <p className="truncate text-xs leading-5 text-fg-tertiary">
        Built from its Dockerfile, or with Railpack when there is none.
      </p>
    </div>
  </div>
);

/**
 * Deploy on push of a GitHub service. Unlike the rest of the form it is not
 * part of a version: the switch saves at once.
 */
const AutoDeployRow = ({ branch }: { branch: string }) => {
  const id = useId();
  const { project, replaceWorkload } = useProject();
  const { workload } = useWorkloadActions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (checked: boolean) => {
    setSaving(true);
    setError(null);

    try {
      replaceWorkload(
        await workloadsApi.update(project.id, workload.id, {
          auto_deploy: checked,
        }),
      );
    } catch (failure) {
      setError(getApiErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <InlineRow
      label="Deploy on push"
      htmlFor={id}
      hint={
        <>
          Pushes to <span className="font-mono">{branch}</span> build and
          deploy. Saves at once.
        </>
      }
      footer={
        error ? (
          <p role="alert" className="mt-1.5 text-xs text-status-danger">
            {error}
          </p>
        ) : null
      }
    >
      <Switch
        id={id}
        checked={workload.auto_deploy ?? true}
        disabled={saving}
        onCheckedChange={(checked) => void toggle(checked)}
      />
    </InlineRow>
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
  const { field: branch } = useController({ control, name: 'branch' });
  // Builds set the image of a GitHub service; only its branch can change.
  const source =
    workload.type === 'github'
      ? (config as unknown as GithubWorkloadConfig)
      : null;
  // A static site's server, files and storage are the platform's.
  const isSite = workload.type === 'static';

  return (
    <form onSubmit={onSubmit} noValidate>
      <DetailStack>
        {isDirty ? (
          <UnsavedChangesBanner
            message={errors.root?.message}
            isSaving={isSaving}
            isLocked={isLocked}
            onDiscard={() => {
              clearErrors('root');
              reset(toForm(config));
            }}
          />
        ) : null}

        {isSite ? null : (
          <DetailSection
            title="Source"
            description={
              source
                ? 'The repository and branch each deploy builds.'
                : 'The image to run and how its process starts.'
            }
          >
            <div className="divide-y divide-edge-subtle">
              {source ? (
                <>
                  <RepositoryHeader repository={source.repository} />
                  <InlineRow
                    label="Branch"
                    htmlFor="workload-config-branch"
                    hint="Deploy builds its latest commit."
                  >
                    <div className="w-44 sm:w-56">
                      <GithubBranchSelect
                        id="workload-config-branch"
                        appId={source.github_app_id}
                        repository={source.repository}
                        value={branch.value}
                        onChange={branch.onChange}
                        disabled={isLocked}
                      />
                    </div>
                  </InlineRow>
                  <AutoDeployRow branch={source.branch} />
                </>
              ) : (
                <>
                  <SettingRow
                    label="Image"
                    htmlFor="workload-config-image"
                    hint="Tag or digest."
                  >
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
                    <FieldError
                      errors={[errors.dockerImage]}
                      className="mt-1.5"
                    />
                  </SettingRow>

                  <SettingRow
                    label="Entrypoint"
                    htmlFor="workload-config-entrypoint"
                    hint="Replaces ENTRYPOINT."
                  >
                    <Input
                      id="workload-config-entrypoint"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Image default"
                      aria-invalid={!!errors.entrypoint}
                      className="font-mono"
                      {...register('entrypoint', { validate: validateArgs })}
                    />
                    <FieldError
                      errors={[errors.entrypoint]}
                      className="mt-1.5"
                    />
                  </SettingRow>

                  <SettingRow
                    label="Command"
                    htmlFor="workload-config-command"
                    hint="Replaces CMD."
                  >
                    <Input
                      id="workload-config-command"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Image default"
                      aria-invalid={!!errors.command}
                      aria-describedby="workload-config-command-help"
                      className="font-mono"
                      {...register('command', { validate: validateArgs })}
                    />
                    <p
                      id="workload-config-command-help"
                      className="mt-1.5 text-xs leading-5 text-fg-tertiary"
                    >
                      Split like a shell line. Quote arguments that contain
                      spaces.
                    </p>
                    <FieldError errors={[errors.command]} className="mt-1.5" />
                  </SettingRow>
                </>
              )}
            </div>
          </DetailSection>
        )}

        <DockerWorkloadPrivateNetwork />

        <DockerWorkloadNetwork />

        <DetailSection
          title="Resources"
          description="Limits apply to each replica. Saved changes roll out on the next deploy."
        >
          <div className="divide-y divide-edge-subtle">
            <LimitField
              control={control}
              label="CPU"
              hint="Per replica."
              limitedName="cpuLimited"
              valueName="cpuMax"
              range={CPU_RANGE}
              format={formatCpu}
              disabled={isLocked}
            />
            <LimitField
              control={control}
              label="Memory"
              hint="Per replica."
              limitedName="ramLimited"
              valueName="ramMax"
              range={RAM_RANGE}
              format={formatMemory}
              disabled={isLocked}
            />
            <ReplicasField control={control} disabled={isLocked} />
          </div>
        </DetailSection>

        {isSite ? null : <DockerWorkloadVolumes />}

        {isSite ? null : (
          <DetailSection
            title="Placement"
            description="Run the service only on servers with these labels. Set labels on the Servers page."
          >
            <div className="divide-y divide-edge-subtle">
              <SettingRow
                label="Node selector"
                htmlFor="workload-config-node-selector"
                hint="One key=value per line."
              >
                <Textarea
                  id="workload-config-node-selector"
                  rows={3}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Any server"
                  disabled={isLocked}
                  className="font-mono text-xs"
                  {...register('nodeSelector')}
                />
              </SettingRow>
            </div>
          </DetailSection>
        )}
      </DetailStack>
    </form>
  );
};
