'use client';

import { useState, type FormEvent } from 'react';
import type { CustomRole, Member, MemberRole } from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { membersApi } from '@/api/members';
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
import { FieldError, FieldGroup } from '@/shared/components/ui/field';
import { RoleFields, type RoleChoice } from '../components/role-fields';
import { grantableRoles, type GrantableRole } from '../roles';

export const MemberRoleDialog = ({
  member,
  onOpenChange,
  actorRole,
  customRoles,
  onSaved,
}: {
  member: Member | null;
  onOpenChange: (open: boolean) => void;
  actorRole: MemberRole | undefined;
  customRoles: CustomRole[];
  onSaved: (member: Member) => void;
}) => (
  <Dialog open={member !== null} onOpenChange={onOpenChange}>
    {member ? (
      <MemberRoleBody
        key={member.user_id}
        member={member}
        actorRole={actorRole}
        customRoles={customRoles}
        onSaved={(saved) => {
          onSaved(saved);
          onOpenChange(false);
        }}
      />
    ) : null}
  </Dialog>
);

const MemberRoleBody = ({
  member,
  actorRole,
  customRoles,
  onSaved,
}: {
  member: Member;
  actorRole: MemberRole | undefined;
  customRoles: CustomRole[];
  onSaved: (member: Member) => void;
}) => {
  const [choice, setChoice] = useState<RoleChoice>({
    role:
      member.role && member.role !== 'owner'
        ? (member.role as GrantableRole)
        : 'viewer',
    roleId: member.role_id,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      onSaved(
        await membersApi.update(member.user_id, {
          role: choice.role,
          role_id: choice.roleId,
        }),
      );
    } catch (saveError) {
      setError(getApiErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Change role</DialogTitle>
        <DialogDescription>
          {member.name} ({member.email}). The new role applies at once, and
          their open terminals and live logs close.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={save} noValidate>
        <FieldGroup className="mt-6">
          <RoleFields
            id="member"
            value={choice}
            onChange={setChoice}
            roles={grantableRoles(actorRole)}
            customRoles={customRoles}
          />
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
            Save role
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
};
