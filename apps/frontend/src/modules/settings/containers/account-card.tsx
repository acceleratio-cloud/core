'use client';

import { useState, type FormEvent } from 'react';
import { Check, Lock } from 'lucide-react';

import { getApiErrorMessage } from '@/api';
import { useAuth } from '@/modules/auth/providers/auth-provider';
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar';
import { Button } from '@/shared/components/ui/button';
import { FieldError } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { SettingsRow } from '../components/settings-row';
import { PasswordDialog } from './password-dialog';

const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

export const AccountCard = () => {
  const { user, isPending, updateName } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  if (isPending || !user) {
    return (
      <section
        aria-label="Account"
        aria-busy="true"
        className="panel-lit rounded-lg p-6"
      >
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-56" />
          </div>
        </div>
        <Skeleton className="mt-6 h-32" />
      </section>
    );
  }

  const startEdit = () => {
    setDraft(user.name);
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();

    if (!name) {
      setError('Enter your name.');
      return;
    }

    if (name === user.name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await updateName(name);
      setEditing(false);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save your name.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="account-title"
      className="panel-lit rounded-lg"
    >
      <header className="flex items-center gap-4 border-b border-border px-6 py-5">
        <Avatar className="size-14">
          <AvatarFallback className="bg-surface-muted text-lg font-medium tracking-tight">
            {getInitials(user.name) || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h2
            id="account-title"
            className="truncate text-base leading-none font-medium tracking-tight text-foreground"
          >
            {user.name}
          </h2>
          <p className="mt-2 truncate text-sm text-muted-foreground">
            {user.email}
          </p>
        </div>
      </header>

      <div className="divide-y divide-border px-6">
        <SettingsRow
          id="account-name"
          label="Name"
          action={
            editing ? null : (
              <Button variant="outline" size="sm" onClick={startEdit}>
                Edit
              </Button>
            )
          }
        >
          {editing ? (
            <form
              onSubmit={handleSubmit}
              noValidate
              className="flex w-full flex-wrap items-start gap-2"
            >
              <div className="min-w-48 flex-1 sm:max-w-xs">
                <Input
                  autoFocus
                  aria-labelledby="account-name-label"
                  value={draft}
                  maxLength={255}
                  autoComplete="name"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'account-name-error' : undefined}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') cancelEdit();
                  }}
                />
                {error ? (
                  <FieldError
                    id="account-name-error"
                    role="alert"
                    className="mt-1.5"
                  >
                    {error}
                  </FieldError>
                ) : null}
              </div>
              <Button type="submit" loading={saving}>
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={cancelEdit}
              >
                Cancel
              </Button>
            </form>
          ) : (
            user.name
          )}
        </SettingsRow>

        <SettingsRow id="account-email" label="Email">
          <span className="truncate">{user.email}</span>
          <Lock
            aria-label="Locked"
            role="img"
            strokeWidth={1.75}
            className="ml-2 size-3.5 shrink-0 text-muted-foreground"
          />
        </SettingsRow>

        <SettingsRow
          id="account-password"
          label="Password"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPasswordOpen(true)}
            >
              Change password
            </Button>
          }
        >
          {passwordChanged ? (
            <span
              role="status"
              className="flex items-center gap-1.5 text-status-success"
            >
              <Check aria-hidden="true" strokeWidth={2} className="size-3.5" />
              Password changed
            </span>
          ) : (
            <span
              aria-label="Hidden"
              className="tracking-widest text-muted-foreground"
            >
              ••••••••••
            </span>
          )}
        </SettingsRow>
      </div>

      <PasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        onChanged={() => setPasswordChanged(true)}
      />
    </section>
  );
};
