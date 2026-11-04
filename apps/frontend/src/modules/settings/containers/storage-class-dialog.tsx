'use client';

import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import type { StorageClass, StorageEnvironment } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
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
import { Select } from '@/shared/components/ui/select';
import { Switch } from '@/shared/components/ui/switch';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  BINDING_MODE_LABELS,
  DESCRIPTION_MAX_LENGTH,
  DISK_TYPE_SUGGESTIONS,
  EMPTY_FORM,
  INTEGER_LIMITS,
  NAME_MAX_LENGTH,
  REPLICATION_OPTIONS,
  TAG_PATTERN,
  TTL_PATTERN,
  replicationCopies,
  toForm,
  validateInteger,
  type StorageClassDialogMode,
  type StorageClassForm,
} from '../utils/storage-class-form';

type StorageClassDialogProps = {
  open: boolean;
  mode: StorageClassDialogMode;
  /** Source class for edit, view and duplicate. */
  storageClass: StorageClass | null;
  environment: StorageEnvironment | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: StorageClassForm) => Promise<void>;
};

const TITLES: Record<StorageClassDialogMode, string> = {
  create: 'New storage class',
  duplicate: 'Duplicate storage class',
  edit: 'Edit storage class',
  view: 'Platform storage class',
};

const DESCRIPTIONS: Record<StorageClassDialogMode, string> = {
  create:
    'A SeaweedFS-backed StorageClass. Volumes and buckets can pick it once it exists.',
  duplicate:
    'Creates a new class from these settings. The original stays unchanged.',
  edit: 'Storage settings are fixed once a class exists. Duplicate it to change them.',
  view: 'Created by the installer and used by default. It cannot be changed here.',
};

const SUBMIT_LABELS: Record<StorageClassDialogMode, string> = {
  create: 'Create class',
  duplicate: 'Create class',
  edit: 'Save changes',
  view: '',
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
        <Lock
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3 text-muted-foreground"
        />
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

export const StorageClassDialog = ({
  open,
  mode,
  storageClass,
  environment,
  onOpenChange,
  onSubmit,
}: StorageClassDialogProps) => {
  const {
    register,
    control,
    handleSubmit,
    reset,
    clearErrors,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<StorageClassForm>({ defaultValues: EMPTY_FORM });

  useEffect(() => {
    if (open) {
      reset(storageClass ? toForm(storageClass, mode) : EMPTY_FORM);
    }
  }, [open, mode, storageClass, reset]);

  const replication = useWatch({ control, name: 'replication' });
  const ttl = useWatch({ control, name: 'ttl' });
  const writebackCache = useWatch({ control, name: 'writeback_cache' });

  const readOnly = mode === 'view';
  // Kubernetes cannot change these on an existing StorageClass.
  const locked = mode === 'edit' || mode === 'view';
  const copies = replicationCopies(replication);
  const volumeServers = environment?.volume_servers ?? null;
  const replicationOptions = REPLICATION_OPTIONS.some(
    (option) => option.value === replication,
  )
    ? REPLICATION_OPTIONS
    : [...REPLICATION_OPTIONS, { value: replication, label: replication }];
  const extraParameters = Object.entries(storageClass?.extra_parameters ?? {});

  const submit = handleSubmit(async (form) => {
    clearErrors('root');

    try {
      await onSubmit(form);
      onOpenChange(false);
    } catch (error) {
      setError('root', { message: getApiErrorMessage(error) });
    }
  });

  const id = (field: string) => `storage-class-${field}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{TITLES[mode]}</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[mode]}</DialogDescription>
        </DialogHeader>

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
                    value.trim() !== '' || 'Give the class a name.',
                })}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field data-invalid={errors.description ? true : undefined}>
              <FieldLabel htmlFor={id('description')}>Description</FieldLabel>
              <Textarea
                id={id('description')}
                placeholder="What this class is tuned for"
                maxLength={DESCRIPTION_MAX_LENGTH}
                disabled={readOnly}
                {...register('description')}
              />
            </Field>

            {storageClass && locked ? (
              <p className="font-mono text-[11px] text-muted-foreground">
                {storageClass.external_name}
              </p>
            ) : null}
          </FieldGroup>

          <Section title="Performance and durability" locked={locked}>
            <Field>
              <FieldLabel htmlFor={id('replication')}>Replication</FieldLabel>
              <Select
                id={id('replication')}
                disabled={locked}
                {...register('replication')}
              >
                {replicationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldDescription>
                More copies survive server loss but write slower and use more
                disk.
              </FieldDescription>
              {!locked && volumeServers !== null && copies > volumeServers ? (
                <Warning>
                  This needs {copies} volume servers and the cluster has{' '}
                  {volumeServers}. Writes to these volumes will fail.
                </Warning>
              ) : null}
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={errors.disk_type ? true : undefined}>
                <FieldLabel htmlFor={id('disk-type')}>Disk type</FieldLabel>
                <Input
                  id={id('disk-type')}
                  list={id('disk-type-options')}
                  placeholder="Any disk"
                  autoComplete="off"
                  disabled={locked}
                  aria-invalid={!!errors.disk_type}
                  {...register('disk_type', {
                    validate: (value) =>
                      value.trim() === '' ||
                      TAG_PATTERN.test(value.trim()) ||
                      'Use up to 32 lowercase letters, digits, - or _.',
                  })}
                />
                <datalist id={id('disk-type-options')}>
                  {DISK_TYPE_SUGGESTIONS.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
                <FieldError errors={[errors.disk_type]} />
              </Field>

              <Field data-invalid={errors.collection ? true : undefined}>
                <FieldLabel htmlFor={id('collection')}>Collection</FieldLabel>
                <Input
                  id={id('collection')}
                  placeholder="One per volume"
                  autoComplete="off"
                  disabled={locked}
                  aria-invalid={!!errors.collection}
                  {...register('collection', {
                    validate: (value) =>
                      value.trim() === '' ||
                      TAG_PATTERN.test(value.trim()) ||
                      'Use up to 32 lowercase letters, digits, - or _.',
                  })}
                />
                <FieldError errors={[errors.collection]} />
              </Field>
            </div>

            <Field data-invalid={errors.ttl ? true : undefined}>
              <FieldLabel htmlFor={id('ttl')}>Data TTL</FieldLabel>
              <Input
                id={id('ttl')}
                placeholder="Keep forever"
                autoComplete="off"
                disabled={locked}
                aria-invalid={!!errors.ttl}
                {...register('ttl', {
                  validate: (value) =>
                    value.trim() === '' ||
                    TTL_PATTERN.test(value.trim()) ||
                    'Use a number and a unit: m, h, d, w, M or y (such as 7d).',
                })}
              />
              <FieldError errors={[errors.ttl]} />
              {!locked && ttl.trim() !== '' && !errors.ttl ? (
                <Warning>
                  Data older than {ttl.trim()} is deleted. Use it only for
                  caches and scratch space.
                </Warning>
              ) : null}
            </Field>
          </Section>

          <Section title="Lifecycle" locked={locked}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={id('reclaim-policy')}>
                  When a volume is deleted
                </FieldLabel>
                <Select
                  id={id('reclaim-policy')}
                  disabled={locked}
                  {...register('reclaim_policy')}
                >
                  <option value="Delete">Delete its data</option>
                  <option value="Retain">Keep its data</option>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor={id('binding-mode')}>
                  Volume binding
                </FieldLabel>
                <Select
                  id={id('binding-mode')}
                  disabled={locked}
                  {...register('volume_binding_mode')}
                >
                  {Object.entries(BINDING_MODE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
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
                Allow volumes to grow after creation
              </FieldLabel>
            </Field>
          </Section>

          <details className="group border-t border-border pt-5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-foreground outline-none focus-visible:underline">
              Advanced mount tuning
              {locked ? (
                <Lock
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3 text-muted-foreground"
                />
              ) : null}
              <span className="text-muted-foreground group-open:hidden">
                · driver defaults
              </span>
            </summary>

            <FieldGroup className="mt-4">
              <div className="grid gap-5 sm:grid-cols-3">
                <Field
                  data-invalid={errors.cache_capacity_mb ? true : undefined}
                >
                  <FieldLabel htmlFor={id('cache')}>Cache (MB)</FieldLabel>
                  <Input
                    id={id('cache')}
                    inputMode="numeric"
                    placeholder="Default"
                    disabled={locked}
                    aria-invalid={!!errors.cache_capacity_mb}
                    className="tabular-nums"
                    {...register('cache_capacity_mb', {
                      validate: validateInteger(
                        INTEGER_LIMITS.cache_capacity_mb,
                      ),
                    })}
                  />
                  <FieldError errors={[errors.cache_capacity_mb]} />
                </Field>
                <Field
                  data-invalid={errors.concurrent_writers ? true : undefined}
                >
                  <FieldLabel htmlFor={id('writers')}>
                    Concurrent writers
                  </FieldLabel>
                  <Input
                    id={id('writers')}
                    inputMode="numeric"
                    placeholder="Default"
                    disabled={locked}
                    aria-invalid={!!errors.concurrent_writers}
                    className="tabular-nums"
                    {...register('concurrent_writers', {
                      validate: validateInteger(
                        INTEGER_LIMITS.concurrent_writers,
                      ),
                    })}
                  />
                  <FieldError errors={[errors.concurrent_writers]} />
                </Field>
                <Field
                  data-invalid={errors.chunk_size_limit_mb ? true : undefined}
                >
                  <FieldLabel htmlFor={id('chunk')}>Chunk size (MB)</FieldLabel>
                  <Input
                    id={id('chunk')}
                    inputMode="numeric"
                    placeholder="Default"
                    disabled={locked}
                    aria-invalid={!!errors.chunk_size_limit_mb}
                    className="tabular-nums"
                    {...register('chunk_size_limit_mb', {
                      validate: validateInteger(
                        INTEGER_LIMITS.chunk_size_limit_mb,
                      ),
                    })}
                  />
                  <FieldError errors={[errors.chunk_size_limit_mb]} />
                </Field>
              </div>

              <Field orientation="horizontal">
                <Controller
                  control={control}
                  name="writeback_cache"
                  render={({ field }) => (
                    <Switch
                      id={id('writeback')}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={locked}
                    />
                  )}
                />
                <FieldLabel htmlFor={id('writeback')}>
                  Write-back cache
                </FieldLabel>
              </Field>
              {!locked && writebackCache ? (
                <Warning>
                  Writes are acknowledged before they reach SeaweedFS. A node
                  crash can lose recent data.
                </Warning>
              ) : null}

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
            </FieldGroup>
          </details>

          <FieldError>{errors.root?.message}</FieldError>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {readOnly ? 'Close' : 'Cancel'}
            </DialogClose>
            {readOnly ? null : (
              <Button
                type="submit"
                loading={isSubmitting}
                disabled={mode === 'edit' && !isDirty}
              >
                {SUBMIT_LABELS[mode]}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
