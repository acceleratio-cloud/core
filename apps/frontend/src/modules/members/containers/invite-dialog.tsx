'use client';

import { useState, type FormEvent } from 'react';
import type { CustomRole, Invite, MemberRole } from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { membersApi } from '@/api/members';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { RoleFields, type RoleChoice } from '../components/role-fields';
import { grantableRoles } from '../roles';

const USES = [
  { value: 'one', label: 'One person' },
  { value: 'many', label: 'Anyone with the link' },
];

export const InviteDialog = ({
  open,
  onOpenChange,
  actorRole,
  customRoles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorRole: MemberRole | undefined;
  customRoles: CustomRole[];
  onCreated: (invite: Invite) => void;
}) => {
  const [choice, setChoice] = useState<RoleChoice>({
    role: 'viewer',
    roleId: null,
  });
  const [uses, setUses] = useState('one');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setChoice({ role: 'viewer', roleId: null });
      setUses('one');
      setLink(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const created = await membersApi.createInvite({
        role: choice.role,
        role_id: choice.roleId,
        max_uses: uses === 'one' ? 1 : null,
      });

      setLink(
        `${window.location.origin}/auth/invite/${encodeURIComponent(created.token)}`,
      );
      onCreated(created.invite);
    } catch (createError) {
      setError(getApiErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            The link creates an account with the role you choose. It expires in
            7 days.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <FieldGroup className="mt-6">
            <Field>
              <FieldLabel htmlFor="invite-link">Invite link</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="invite-link"
                  readOnly
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton value={link} label="Copy invite link" />
              </div>
              <FieldDescription>
                Copy it now: it is shown only once.{' '}
                {uses === 'one'
                  ? 'It works for one account.'
                  : 'Anyone with it can join until it expires or you revoke it.'}
              </FieldDescription>
            </Field>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>Done</DialogClose>
            </DialogFooter>
          </FieldGroup>
        ) : (
          <form onSubmit={create} noValidate>
            <FieldGroup className="mt-6">
              <RoleFields
                id="invite"
                value={choice}
                onChange={setChoice}
                roles={grantableRoles(actorRole)}
                customRoles={customRoles}
              />
              <Field>
                <FieldLabel htmlFor="invite-uses">Who can use it</FieldLabel>
                <Select
                  value={uses}
                  items={USES}
                  onValueChange={(next) => {
                    if (typeof next === 'string') {
                      setUses(next);
                    }
                  }}
                >
                  <SelectTrigger id="invite-uses" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <FieldError>{error}</FieldError>
            </FieldGroup>

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                Cancel
              </DialogClose>
              <Button
                type="submit"
                loading={busy}
                disabled={choice.role === 'custom' && !choice.roleId}
              >
                Create link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
