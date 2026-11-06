'use client';

import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { getApiErrorMessage } from '@/api';
import { authApi } from '@/api/auth';
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
import { Switch } from '@/shared/components/ui/switch';
import {
  PASSWORD_MIN_LENGTH,
  validatePasswordForm,
  type PasswordFormErrors,
  type PasswordFormValues,
} from '../utils/password';

const EMPTY: PasswordFormValues = { current: '', next: '', confirm: '' };

type PasswordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

export const PasswordDialog = ({
  open,
  onOpenChange,
  onChanged,
}: PasswordDialogProps) => {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<PasswordFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (saving) return;

    if (!next) {
      setValues(EMPTY);
      setErrors({});
      setFormError(null);
      setReveal(false);
    }

    onOpenChange(next);
  };

  const setField = (key: keyof PasswordFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validatePasswordForm(values);
    setErrors(found);

    const first = (['current', 'next', 'confirm'] as const).find(
      (key) => found[key],
    );

    if (first) {
      document.getElementById(`password-${first}`)?.focus();
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await authApi.changePassword({
        current_password: values.current,
        new_password: values.next,
        revoke_other_sessions: revokeOthers,
      });
      setSaving(false);
      onChanged();
      handleOpenChange(false);
    } catch (err) {
      setSaving(false);
      setFormError(getApiErrorMessage(err, 'Could not change the password.'));
      document.getElementById('password-current')?.focus();
    }
  };

  const inputType = reveal ? 'text' : 'password';
  const inputProps = (key: keyof PasswordFormValues, error?: string) => ({
    id: `password-${key}`,
    value: values[key],
    type: inputType,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `password-${key}-error` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setField(key, event.target.value),
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Enter your current password, then choose a new one.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="mt-5">
          <FieldGroup>
            <Field data-invalid={errors.current || formError ? true : undefined}>
              <FieldLabel htmlFor="password-current">Current password</FieldLabel>
              <Input
                {...inputProps('current', errors.current ?? formError ?? undefined)}
                name="current_password"
                autoComplete="current-password"
                autoFocus
              />
              {errors.current ? (
                <FieldError id="password-current-error" role="alert">
                  {errors.current}
                </FieldError>
              ) : formError ? (
                <FieldError id="password-current-error" role="alert">
                  {formError}
                </FieldError>
              ) : null}
            </Field>

            <Field data-invalid={errors.next ? true : undefined}>
              <FieldLabel htmlFor="password-next">New password</FieldLabel>
              <Input
                {...inputProps('next', errors.next)}
                name="new_password"
                autoComplete="new-password"
              />
              {errors.next ? (
                <FieldError id="password-next-error" role="alert">
                  {errors.next}
                </FieldError>
              ) : (
                <FieldDescription>
                  At least {PASSWORD_MIN_LENGTH} characters.
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={errors.confirm ? true : undefined}>
              <FieldLabel htmlFor="password-confirm">Repeat new password</FieldLabel>
              <Input
                {...inputProps('confirm', errors.confirm)}
                name="confirm_password"
                autoComplete="new-password"
              />
              {errors.confirm ? (
                <FieldError id="password-confirm-error" role="alert">
                  {errors.confirm}
                </FieldError>
              ) : null}
            </Field>

            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="password-revoke"
                className="text-sm text-foreground"
              >
                Sign out other devices
                <span className="block text-[13px] text-muted-foreground">
                  Ends every session except this one.
                </span>
              </label>
              <Switch
                id="password-revoke"
                checked={revokeOthers}
                onCheckedChange={setRevokeOthers}
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              aria-pressed={reveal}
              onClick={() => setReveal((prev) => !prev)}
            >
              {reveal ? (
                <EyeOff aria-hidden="true" strokeWidth={1.75} data-icon="inline-start" />
              ) : (
                <Eye aria-hidden="true" strokeWidth={1.75} data-icon="inline-start" />
              )}
              {reveal ? 'Hide passwords' : 'Show passwords'}
            </Button>
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="ghost" />}
              disabled={saving}
            >
              Cancel
            </DialogClose>
            <Button type="submit" loading={saving}>
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
