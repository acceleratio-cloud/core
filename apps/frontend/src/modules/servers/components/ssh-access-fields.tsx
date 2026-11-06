import { useId } from 'react';

import type { NodeSshAccess } from '@acceleratio/shared';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';

export type SshForm = {
  host: string;
  port: string;
  username: string;
  privateKey: string;
  passphrase: string;
};

export const emptySshForm: SshForm = {
  host: '',
  port: '22',
  username: 'root',
  privateKey: '',
  passphrase: '',
};

export const toSshAccess = (form: SshForm): NodeSshAccess => ({
  host: form.host.trim(),
  port: Number(form.port) || undefined,
  username: form.username.trim(),
  private_key: form.privateKey,
  passphrase: form.passphrase || undefined,
});

/** Connection fields. The key is sent once and never stored by the API. */
export const SshAccessFields = ({
  value,
  onChange,
  disabled,
  hostEditable = true,
}: {
  value: SshForm;
  onChange: (next: SshForm) => void;
  disabled?: boolean;
  hostEditable?: boolean;
}) => {
  const id = useId();
  const set = (patch: Partial<SshForm>) => onChange({ ...value, ...patch });

  return (
    <FieldGroup>
      <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-host`}>Address</FieldLabel>
          <Input
            id={`${id}-host`}
            autoComplete="off"
            spellCheck={false}
            placeholder="203.0.113.10"
            value={value.host}
            disabled={disabled || !hostEditable}
            onChange={(event) => set({ host: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-port`}>Port</FieldLabel>
          <Input
            id={`${id}-port`}
            inputMode="numeric"
            value={value.port}
            disabled={disabled}
            onChange={(event) => set({ port: event.target.value })}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor={`${id}-user`}>User</FieldLabel>
        <Input
          id={`${id}-user`}
          autoComplete="off"
          spellCheck={false}
          value={value.username}
          disabled={disabled}
          onChange={(event) => set({ username: event.target.value })}
        />
        <FieldDescription>
          Root, or a user with passwordless sudo.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor={`${id}-key`}>Private key</FieldLabel>
        <Textarea
          id={`${id}-key`}
          autoComplete="off"
          spellCheck={false}
          rows={4}
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          className="font-mono text-xs"
          value={value.privateKey}
          disabled={disabled}
          onChange={(event) => set({ privateKey: event.target.value })}
        />
        <FieldDescription>
          Used for this operation only. It is not stored.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor={`${id}-pass`}>Key passphrase</FieldLabel>
        <Input
          id={`${id}-pass`}
          type="password"
          autoComplete="off"
          placeholder="Optional"
          value={value.passphrase}
          disabled={disabled}
          onChange={(event) => set({ passphrase: event.target.value })}
        />
      </Field>
    </FieldGroup>
  );
};
