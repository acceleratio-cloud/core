'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link2, Plus, UserPlus } from 'lucide-react';
import type {
  CustomRole,
  Invite,
  Member,
  Project,
} from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { membersApi } from '@/api/members';
import { projectsApi } from '@/api/projects';
import { useAuth } from '@/modules/auth/providers/auth-provider';
import { isManager } from '@/modules/auth/utils/access';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import { ConfirmDialog } from '../components/confirm-dialog';
import { EmptyPanel } from '../components/empty-panel';
import { InvitesTable } from '../components/invites-table';
import { MembersTable } from '../components/members-table';
import { RolesGrid } from '../components/roles-grid';
import { CustomRoleDialog } from './custom-role-dialog';
import { InviteDialog } from './invite-dialog';
import { MemberRoleDialog } from './member-role-dialog';

type Data = {
  members: Member[];
  roles: CustomRole[];
  invites: Invite[];
  projects: Project[];
};

type Tab = 'members' | 'invites' | 'roles';

const fetchData = async (): Promise<Data> => {
  const [members, roles, invites, projects] = await Promise.all([
    membersApi.list(),
    membersApi.listRoles(),
    membersApi.listInvites(),
    projectsApi.list(),
  ]);

  return { members, roles, invites, projects };
};

type Pending =
  | { kind: 'remove' | 'transfer'; member: Member }
  | { kind: 'revoke'; invite: Invite }
  | { kind: 'delete-role'; role: CustomRole };

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const Count = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full bg-surface-muted px-1.5 text-[11px] text-fg-secondary tabular-nums">
    {children}
  </span>
);

export const UsersView = () => {
  const { user, access } = useAuth();
  const actorRole = access?.role;
  const manager = isManager(access);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('members');
  const [inviting, setInviting] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [roleDialog, setRoleDialog] = useState<{
    role: CustomRole | null;
  } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // Separate from `pending`, so the dialog keeps its text while it closes.
  const [confirming, setConfirming] = useState(false);
  const ask = (next: Pending) => {
    setPending(next);
    setConfirming(true);
  };

  const load = useCallback(async () => {
    try {
      setData(await fetchData());
      setError(null);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    }
  }, []);

  useEffect(() => {
    let active = true;

    fetchData()
      .then((loaded) => {
        if (active) setData(loaded);
      })
      .catch((loadError) => {
        if (active) setError(getApiErrorMessage(loadError));
      });

    return () => {
      active = false;
    };
  }, []);

  const confirm = async () => {
    if (pending?.kind === 'transfer') {
      await membersApi.transferOwnership(pending.member.user_id);
      // The current user is now an admin: their own menus change.
      window.location.reload();
      return;
    }

    if (pending?.kind === 'remove') {
      await membersApi.remove(pending.member.user_id);
    } else if (pending?.kind === 'revoke') {
      await membersApi.revokeInvite(pending.invite.id);
    } else if (pending?.kind === 'delete-role') {
      await membersApi.removeRole(pending.role.id);
    }

    await load();
  };

  const inviteButton = (variant: 'default' | 'outline') => (
    <Button variant={variant} onClick={() => setInviting(true)}>
      <UserPlus data-icon="inline-start" aria-hidden="true" strokeWidth={1.75} />
      Invite people
    </Button>
  );

  const createRoleButton = manager ? (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setRoleDialog({ role: null })}
    >
      <Plus data-icon="inline-start" aria-hidden="true" strokeWidth={1.75} />
      Create role
    </Button>
  ) : undefined;

  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
            Users
          </h1>
          <p
            aria-live="polite"
            className="mt-2.5 text-sm text-muted-foreground"
          >
            {data
              ? `${plural(data.members.length, 'member', 'members')} · ${plural(data.invites.length, 'open invite link', 'open invite links')}`
              : 'Who can sign in to this installation, and what they can do.'}
          </p>
        </div>
        {manager ? inviteButton('default') : null}
      </div>

      {data === null ? (
        error ? (
          <p role="alert" className="mt-6 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <div aria-busy="true" className="mt-6 flex flex-col gap-4">
            <span className="sr-only">Loading users...</span>
            <Skeleton className="h-10 w-72 rounded-md" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        )
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          className="mt-6"
        >
          <TabsList aria-label="Users sections">
            <TabsTrigger value="members">
              Members
              <Count>{data.members.length}</Count>
            </TabsTrigger>
            <TabsTrigger value="invites">
              Invite links
              <Count>{data.invites.length}</Count>
            </TabsTrigger>
            <TabsTrigger value="roles">
              Roles
              <Count>{3 + data.roles.length}</Count>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="pt-5">
            <MembersTable
              members={data.members}
              selfId={user?.id}
              actorRole={actorRole}
              onChangeRole={setEditingMember}
              onTransfer={(member) => ask({ kind: 'transfer', member })}
              onRemove={(member) => ask({ kind: 'remove', member })}
            />
          </TabsContent>

          <TabsContent value="invites" className="pt-5">
            {data.invites.length === 0 ? (
              <EmptyPanel
                icon={Link2}
                title="No open invite links"
                description="An invite link lets someone create their own account with the role you pick. It is shown once and expires after 7 days."
                action={manager ? inviteButton('outline') : undefined}
              />
            ) : (
              <>
                <InvitesTable
                  invites={data.invites}
                  actorRole={actorRole}
                  onRevoke={(invite) => ask({ kind: 'revoke', invite })}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  A link is shown only when it is created. Expired and used-up
                  links drop off this list.
                </p>
              </>
            )}
          </TabsContent>

          <TabsContent value="roles" className="pt-5">
            <RolesGrid
              members={data.members}
              roles={data.roles}
              createAction={createRoleButton}
              onEdit={manager ? (role) => setRoleDialog({ role }) : undefined}
              onDelete={
                manager
                  ? (role) => ask({ kind: 'delete-role', role })
                  : undefined
              }
            />
          </TabsContent>
        </Tabs>
      )}

      {data ? (
        <>
          <InviteDialog
            open={inviting}
            onOpenChange={setInviting}
            actorRole={actorRole}
            customRoles={data.roles}
            onCreated={(invite) => {
              setData((current) =>
                current
                  ? { ...current, invites: [...current.invites, invite] }
                  : current,
              );
              setTab('invites');
            }}
          />
          <MemberRoleDialog
            member={editingMember}
            onOpenChange={(open) => !open && setEditingMember(null)}
            actorRole={actorRole}
            customRoles={data.roles}
            onSaved={() => void load()}
          />
          <CustomRoleDialog
            open={roleDialog !== null}
            role={roleDialog?.role ?? null}
            projects={data.projects}
            onOpenChange={(open) => !open && setRoleDialog(null)}
            onSaved={() => void load()}
          />
        </>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        {...confirmCopy(pending)}
        onConfirm={confirm}
      />
    </div>
  );
};

const confirmCopy = (pending: Pending | null) => {
  switch (pending?.kind) {
    case 'remove':
      return {
        title: `Remove ${pending.member.name}?`,
        description: `Their account (${pending.member.email}) is deleted and every session ends. They can join again only with a new invite.`,
        confirmLabel: 'Remove',
        destructive: true,
      };
    case 'transfer':
      return {
        title: `Make ${pending.member.name} the owner?`,
        description:
          'There is one owner. You become an admin and can no longer manage admins or transfer ownership back.',
        confirmLabel: 'Transfer ownership',
        destructive: true,
      };
    case 'revoke':
      return {
        title: 'Revoke this invite link?',
        description: 'The link stops working at once. Accounts it already created stay.',
        confirmLabel: 'Revoke',
        destructive: true,
      };
    case 'delete-role':
      return {
        title: `Delete ${pending.role.name}?`,
        description:
          'Its open invite links stop working. A role still assigned to members cannot be deleted.',
        confirmLabel: 'Delete role',
        destructive: true,
      };
    default:
      return { title: '', description: '', confirmLabel: '' };
  }
};
