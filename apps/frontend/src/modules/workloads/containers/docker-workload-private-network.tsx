'use client';

import { useId, useState } from 'react';
import { Network, Pencil } from 'lucide-react';

import { DetailSection } from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  INTERNAL_DNS_SUFFIX,
  INTERNAL_HOSTNAME_MAX_LENGTH,
  internalHostnameError,
  normalizeInternalHostname,
} from '@/modules/workloads/utils/internal-hostname';
import { CopyButton } from '@/shared/components/copy-button';
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
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { useWorkloadActions } from './workload-actions';
import { DialogShell, SubmitError } from './workload-domain-dialogs';

const EditInternalHostnameDialog = ({
  open,
  onOpenChange,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string;
}) => {
  const { updateInternalHostname } = useWorkloadActions();
  const inputId = useId();
  const [value, setValue] = useState(current);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldError = internalHostnameError(value);

  const submit = async () => {
    setTouched(true);

    if (fieldError) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await updateInternalHostname(normalizeInternalHostname(value));
      onOpenChange(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell open={open} busy={busy} onOpenChange={onOpenChange}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // The section renders inside the config form in the React tree,
          // and React submit events bubble through portals.
          event.stopPropagation();
          void submit();
        }}
      >
        <DialogHeader>
          <DialogTitle>Change private hostname</DialogTitle>
          <DialogDescription>
            Applies immediately. Services that use the old name stop reaching
            this one until they are updated.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5">
          <Field data-invalid={touched && fieldError ? true : undefined}>
            <FieldLabel htmlFor={inputId}>Hostname</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id={inputId}
                autoComplete="off"
                spellCheck={false}
                maxLength={INTERNAL_HOSTNAME_MAX_LENGTH + 10}
                value={value}
                aria-invalid={touched && !!fieldError}
                onChange={(event) => setValue(event.target.value)}
                className="font-mono"
              />
              <span className="shrink-0 font-mono text-[13px] text-fg-tertiary">
                .{INTERNAL_DNS_SUFFIX}
              </span>
            </div>
            <FieldDescription>
              Lowercase letters, digits and hyphens. Unique in this project.
            </FieldDescription>
            <FieldError
              errors={touched && fieldError ? [{ message: fieldError }] : []}
            />
          </Field>
        </div>

        <SubmitError error={error} />

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? 'Saving' : 'Save hostname'}
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
};

/**
 * The private address of a Docker service: `<hostname>.internal` reaches it
 * on any port from every service of the same project, and never from another
 * project. It is always on. Renaming applies at once, outside the draft. It
 * sits inside the config form, so its buttons are `type="button"`.
 */
export const DockerWorkloadPrivateNetwork = () => {
  const { workload } = useWorkloadActions();
  const [editing, setEditing] = useState(false);
  const hostname = workload.internal_hostname;
  const domain = workload.internal_domain;

  if (!hostname || !domain) {
    return null;
  }

  return (
    <>
      <DetailSection
        title="Private network"
        description="Other services in this project reach this one on any port. Always on; other projects cannot connect."
      >
        <div className="group flex min-h-14 items-center gap-3 py-2 pr-2 pl-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-edge-default bg-surface-sunken"
          >
            <Network strokeWidth={1.75} className="size-4 text-fg-tertiary" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-0.5">
              <span
                className="truncate font-mono text-[13px] leading-5 text-fg-primary"
                title={domain}
              >
                {domain}
              </span>
              <CopyButton
                value={domain}
                label={`Private hostname ${domain}`}
                className="text-fg-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              />
            </div>
            <p className="text-xs leading-5 text-fg-tertiary">
              {workload.last_deployed_at
                ? 'Resolves to the ready instances; clients that cache the address should look it up again after a restart.'
                : 'Answers after the first deploy.'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Change private hostname"
            onClick={() => setEditing(true)}
          >
            <Pencil
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-4 text-fg-secondary"
            />
          </Button>
        </div>
      </DetailSection>

      <EditInternalHostnameDialog
        key={`internal-${editing}-${hostname}`}
        open={editing}
        onOpenChange={setEditing}
        current={hostname}
      />
    </>
  );
};
