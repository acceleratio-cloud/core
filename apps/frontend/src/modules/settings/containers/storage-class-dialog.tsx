'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, ChevronRight, Lock } from 'lucide-react';
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldPath,
} from 'react-hook-form';

import type { StorageClass, StorageEnvironment } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { cn } from '@/lib/utils';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Switch } from '@/shared/components/ui/switch';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  BINDING_CHOICES,
  choiceValue,
  COPY_CHOICES,
  CUSTOM_CHOICE,
  DESCRIPTION_MAX_LENGTH,
  describeOutcomes,
  DISK_CHOICES,
  EMPTY_FORM,
  formCopies,
  FS_CHOICES,
  LOCALITY_CHOICES,
  NAME_MAX_LENGTH,
  presetForm,
  RECLAIM_CHOICES,
  STORAGE_PRESETS,
  toForm,
  validateTags,
  type Choice,
  type StorageClassDialogMode,
  type StorageClassForm,
  type StoragePreset,
} from '../utils/storage-class-form';

type StorageClassDialogProps = {
  open: boolean;
  mode: StorageClassDialogMode;
  /** Source profile for edit, view and duplicate. */
  storageClass: StorageClass | null;
  environment: StorageEnvironment | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: StorageClassForm) => Promise<void>;
};

const TITLES: Record<StorageClassDialogMode, string> = {
  create: 'New storage profile',
  duplicate: 'Duplicate storage profile',
  edit: 'Edit storage profile',
  view: 'Platform storage profile',
};

const DESCRIPTIONS: Record<StorageClassDialogMode, string> = {
  create:
    'A storage profile decides how volumes and buckets keep their data: how many copies, on which disks, and for how long.',
  duplicate:
    'Creates a new profile from these settings. The original stays unchanged.',
  edit: 'How data is stored is fixed once a profile exists, so volumes never change under you. Duplicate the profile to change it.',
  view: 'Created by the installer and used when nothing else is chosen. It cannot be changed here.',
};

const Section = ({
  title,
  locked,
  children,
}: {
  title: string;
  locked: boolean;
  children: ReactNode;
}) => (
  <section className="border-t border-border pt-5">
    <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
      {title}
      {locked ? (
        <>
          <Lock
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-3 text-muted-foreground"
          />
          <span className="font-normal text-muted-foreground">
            Fixed after creation
          </span>
        </>
      ) : null}
    </h3>
    <FieldGroup className="mt-4">{children}</FieldGroup>
  </section>
);

const Warning = ({ children }: { children: ReactNode }) => (
  <p className="flex items-start gap-1.5 text-[13px] text-fg-secondary">
    <AlertTriangle
      aria-hidden="true"
      strokeWidth={1.75}
      className="mt-0.5 size-3.5 shrink-0 text-status-warning"
    />
    <span>{children}</span>
  </p>
);

type ChoiceSelectProps = {
  id: string;
  choices: Choice[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

const ChoiceSelect = ({
  id,
  choices,
  value,
  disabled,
  onChange,
}: ChoiceSelectProps) => (
  <Select
    value={value}
    items={choices}
    disabled={disabled}
    onValueChange={(next) => {
      if (typeof next === 'string') {
        onChange(next);
      }
    }}
  >
    <SelectTrigger id={id}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {choices.map((choice) => (
        <SelectItem key={choice.value} value={choice.value}>
          {choice.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/** A select over fixed choices that stores its value in one form field. */
const FormChoice = ({
  control,
  name,
  id,
  choices,
  disabled,
}: {
  control: Control<StorageClassForm>;
  name: FieldPath<StorageClassForm>;
  id: string;
  choices: Choice[];
  disabled: boolean;
}) => (
  <Controller
    control={control}
    name={name}
    render={({ field }) => (
      <ChoiceSelect
        id={id}
        choices={choices}
        value={String(field.value)}
        disabled={disabled}
        onChange={field.onChange}
      />
    )}
  />
);

const PresetPicker = ({
  storageServers,
  onPick,
}: {
  storageServers: number | null;
  onPick: (preset: StoragePreset) => void;
}) => (
  <div className="mt-6">
    <p className="text-[13px] font-medium text-foreground">
      Choose a starting point
    </p>
    <ul className="mt-3 flex flex-col gap-2">
      {STORAGE_PRESETS.map((preset) => {
        const unavailable =
          preset.minServers !== null &&
          storageServers !== null &&
          storageServers < preset.minServers;

        return (
          <li key={preset.id}>
            <button
              type="button"
              disabled={unavailable}
              onClick={() => onPick(preset)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-left transition-colors outline-none',
                'hover:bg-surface-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-raised',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {preset.title}
                </span>
                <span className="mt-0.5 block text-[13px] text-fg-secondary">
                  {preset.summary}
                </span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {unavailable
                    ? `Needs ${preset.minServers} storage servers; this cluster has ${storageServers}.`
                    : `Good for: ${preset.useFor}`}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-4 shrink-0 text-muted-foreground"
              />
            </button>
          </li>
        );
      })}
    </ul>
  </div>
);

export const StorageClassDialog = ({
  open,
  onOpenChange,
  ...props
}: StorageClassDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
      {/* The portal unmounts when closed, so each opening starts fresh. */}
      <StorageClassDialogBody {...props} onOpenChange={onOpenChange} />
    </DialogContent>
  </Dialog>
);

const initialForm = (
  storageClass: StorageClass | null,
  mode: StorageClassDialogMode,
) => (storageClass ? toForm(storageClass, mode) : EMPTY_FORM);

const StorageClassDialogBody = ({
  mode,
  storageClass,
  environment,
  onOpenChange,
  onSubmit,
}: Omit<StorageClassDialogProps, 'open'>) => {
  const [initial] = useState(() => initialForm(storageClass, mode));
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    clearErrors,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<StorageClassForm>({ defaultValues: initial });
  const [step, setStep] = useState<'preset' | 'form'>(
    mode === 'create' ? 'preset' : 'form',
  );
  const [customDisk, setCustomDisk] = useState(
    () => choiceValue(DISK_CHOICES, initial.disk_selector) === CUSTOM_CHOICE,
  );

  const loadForm = (form: StorageClassForm) => {
    reset(form);
    setCustomDisk(
      choiceValue(DISK_CHOICES, form.disk_selector) === CUSTOM_CHOICE,
    );
  };

  const form = useWatch({ control }) as StorageClassForm;
  const replicas = form.number_of_replicas ?? EMPTY_FORM.number_of_replicas;

  const readOnly = mode === 'view';
  // Kubernetes cannot change these on an existing StorageClass.
  const locked = mode === 'edit' || mode === 'view';
  const copies = formCopies({ number_of_replicas: replicas });
  const storageServers = environment?.storage_nodes ?? null;
  const copyHint = COPY_CHOICES.find(
    (choice) => choice.value === replicas,
  )?.hint;
  const localityHint = LOCALITY_CHOICES.find(
    (choice) => choice.value === form.data_locality,
  )?.hint;
  const extraParameters = Object.entries(storageClass?.extra_parameters ?? {});
  const outcomes = describeOutcomes({ ...EMPTY_FORM, ...form });

  const submit = handleSubmit(async (values) => {
    clearErrors('root');

    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (error) {
      setError('root', { message: getApiErrorMessage(error) });
    }
  });

  const id = (field: string) => `storage-profile-${field}`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{TITLES[mode]}</DialogTitle>
        <DialogDescription>{DESCRIPTIONS[mode]}</DialogDescription>
      </DialogHeader>

      {step === 'preset' ? (
        <>
          <PresetPicker
            storageServers={storageServers}
            onPick={(preset) => {
              loadForm(presetForm(preset));
              setStep('form');
            }}
          />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
          </DialogFooter>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
          <FieldGroup>
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor={id('name')}>Name</FieldLabel>
              <Input
                id={id('name')}
                autoComplete="off"
                placeholder="Fast SSD"
                maxLength={NAME_MAX_LENGTH}
                disabled={readOnly}
                aria-invalid={!!errors.name}
                {...register('name', {
                  validate: (value) =>
                    value.trim() !== '' || 'Give the profile a name.',
                })}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field>
              <FieldLabel htmlFor={id('description')}>
                What it is for
              </FieldLabel>
              <Textarea
                id={id('description')}
                placeholder="Databases that need fast disks"
                maxLength={DESCRIPTION_MAX_LENGTH}
                disabled={readOnly}
                {...register('description')}
              />
            </Field>
          </FieldGroup>

          <Section title="How data is stored" locked={locked}>
            <Field>
              <FieldLabel htmlFor={id('copies')}>Copies of data</FieldLabel>
              <ChoiceSelect
                id={id('copies')}
                choices={COPY_CHOICES}
                value={replicas}
                disabled={locked}
                onChange={(value) =>
                  setValue('number_of_replicas', value, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
              {copyHint ? (
                <FieldDescription>{copyHint}</FieldDescription>
              ) : null}
              {!locked && storageServers !== null && copies > storageServers ? (
                <Warning>
                  This needs {copies} storage servers and the cluster has{' '}
                  {storageServers}. The profile cannot be created.
                </Warning>
              ) : null}
            </Field>

            <Field data-invalid={errors.disk_selector ? true : undefined}>
              <FieldLabel htmlFor={id('disk')}>Disk</FieldLabel>
              <ChoiceSelect
                id={id('disk')}
                choices={DISK_CHOICES}
                value={
                  customDisk
                    ? CUSTOM_CHOICE
                    : choiceValue(DISK_CHOICES, form.disk_selector ?? '')
                }
                disabled={locked}
                onChange={(value) => {
                  const isCustom = value === CUSTOM_CHOICE;

                  setCustomDisk(isCustom);
                  setValue('disk_selector', isCustom ? '' : value, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
              />
              {customDisk ? (
                <Input
                  aria-label="Custom disk tags"
                  placeholder="nvme, fast"
                  autoComplete="off"
                  disabled={locked}
                  aria-invalid={!!errors.disk_selector}
                  {...register('disk_selector', {
                    validate: (value) =>
                      value.trim() !== '' || !customDisk
                        ? validateTags(value)
                        : 'Enter the disk tags your storage servers use.',
                  })}
                />
              ) : null}
              <FieldDescription>
                Which server disks hold the copies, by the tags set on the
                disks. A tag no disk has keeps volumes from being created.
              </FieldDescription>
              <FieldError errors={[errors.disk_selector]} />
            </Field>

            <Field>
              <FieldLabel htmlFor={id('locality')}>Placement</FieldLabel>
              <FormChoice
                control={control}
                name="data_locality"
                id={id('locality')}
                choices={LOCALITY_CHOICES}
                disabled={locked}
              />
              {localityHint ? (
                <FieldDescription>{localityHint}</FieldDescription>
              ) : null}
              {!locked &&
              form.data_locality === 'strict-local' &&
              copies > 1 ? (
                <Warning>
                  A copy kept strictly on the service’s server allows only one
                  copy.
                </Warning>
              ) : null}
            </Field>
          </Section>

          <Section title="Lifecycle" locked={locked}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={id('reclaim')}>
                  When a volume is deleted
                </FieldLabel>
                <FormChoice
                  control={control}
                  name="reclaim_policy"
                  id={id('reclaim')}
                  choices={RECLAIM_CHOICES}
                  disabled={locked}
                />
              </Field>
            </div>

            <Field orientation="horizontal">
              <Controller
                control={control}
                name="allow_volume_expansion"
                render={({ field }) => (
                  <Switch
                    id={id('expansion')}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={readOnly}
                  />
                )}
              />
              <FieldLabel htmlFor={id('expansion')}>
                Volumes can grow after they are created
              </FieldLabel>
            </Field>
          </Section>

          <section
            aria-label="What this profile means"
            className="rounded-md border border-border bg-surface-muted px-3 py-2.5"
          >
            <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-2">
              {outcomes.map((outcome) => (
                <div key={outcome.label} className="min-w-0">
                  <dt className="text-muted-foreground">{outcome.label}</dt>
                  <dd className="text-foreground">{outcome.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <details className="group border-t border-border pt-5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-foreground outline-none focus-visible:underline">
              <ChevronRight
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
              />
              Advanced
              <span className="font-normal text-muted-foreground">
                Longhorn settings for specific tuning
              </span>
            </summary>

            <FieldGroup className="mt-4">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={id('fs')}>File system</FieldLabel>
                  <FormChoice
                    control={control}
                    name="fs_type"
                    id={id('fs')}
                    choices={FS_CHOICES}
                    disabled={locked}
                  />
                </Field>

                <Field data-invalid={errors.node_selector ? true : undefined}>
                  <FieldLabel htmlFor={id('servers')}>Server tags</FieldLabel>
                  <Input
                    id={id('servers')}
                    placeholder="Any server"
                    autoComplete="off"
                    disabled={locked}
                    aria-invalid={!!errors.node_selector}
                    {...register('node_selector', { validate: validateTags })}
                  />
                  <FieldDescription>
                    Copies go only to servers with these tags.
                  </FieldDescription>
                  <FieldError errors={[errors.node_selector]} />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor={id('binding')}>
                  Create the storage
                </FieldLabel>
                <FormChoice
                  control={control}
                  name="volume_binding_mode"
                  id={id('binding')}
                  choices={BINDING_CHOICES}
                  disabled={locked}
                />
              </Field>

              {extraParameters.length > 0 ? (
                <div>
                  <p className="text-[13px] font-medium text-foreground">
                    Other driver parameters
                  </p>
                  <dl className="mt-2 divide-y divide-border rounded-md border border-border">
                    {extraParameters.map(([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between gap-3 px-3 py-2 text-[13px]"
                      >
                        <dt className="font-mono text-muted-foreground">
                          {key}
                        </dt>
                        <dd className="truncate font-mono" title={value}>
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {storageClass && locked ? (
                <p className="text-[12px] text-muted-foreground">
                  Kubernetes StorageClass{' '}
                  <span className="font-mono">
                    {storageClass.external_name}
                  </span>
                </p>
              ) : null}
            </FieldGroup>
          </details>

          <FieldError>{errors.root?.message}</FieldError>

          <DialogFooter>
            {mode === 'create' ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                onClick={() => setStep('preset')}
              >
                <ArrowLeft
                  aria-hidden="true"
                  strokeWidth={1.75}
                  data-icon="inline-start"
                />
                Presets
              </Button>
            ) : null}
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {readOnly ? 'Close' : 'Cancel'}
            </DialogClose>
            {readOnly ? null : (
              <Button
                type="submit"
                loading={isSubmitting}
                disabled={mode === 'edit' && !isDirty}
              >
                {mode === 'edit' ? 'Save changes' : 'Create profile'}
              </Button>
            )}
          </DialogFooter>
        </form>
      )}
    </>
  );
};
