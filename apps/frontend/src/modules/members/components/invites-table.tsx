import type { Invite, MemberRole } from '@acceleratio/shared';

import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { Button } from '@/shared/components/ui/button';
import { canManage } from '../roles';
import { RoleBadge } from './role-badge';

const usage = (invite: Invite) =>
  invite.use_count === 0
    ? 'Not used yet'
    : `Used by ${invite.use_count} ${invite.use_count === 1 ? 'person' : 'people'}`;

export const InvitesTable = ({
  invites,
  actorRole,
  onRevoke,
}: {
  invites: Invite[];
  actorRole: MemberRole | undefined;
  onRevoke: (invite: Invite) => void;
}) => (
  <div className="relative overflow-x-auto rounded-xl border border-border bg-surface-raised">
    <table className="w-full min-w-[40rem] text-left text-sm">
      <caption className="sr-only">Invite links</caption>
      <thead className="border-b border-border bg-surface-panel text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="w-48 px-4 py-2.5 font-medium">
            Role
          </th>
          <th scope="col" className="px-4 py-2.5 font-medium">
            Who can use it
          </th>
          <th scope="col" className="w-36 px-4 py-2.5 font-medium">
            Expires
          </th>
          <th scope="col" className="w-44 px-4 py-2.5 font-medium">
            Created by
          </th>
          <th scope="col" className="w-24 px-4 py-2.5">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {invites.map((invite) => (
          <tr
            key={invite.id}
            className="transition-colors hover:bg-surface-muted/40"
          >
            <td className="px-4 py-3">
              <RoleBadge role={invite.role} name={invite.role_name} />
            </td>
            <td className="px-4 py-3">
              <p className="text-foreground">
                {invite.max_uses === 1 ? 'One person' : 'Anyone with the link'}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {usage(invite)}
              </p>
            </td>
            <td className="px-4 py-3 text-muted-foreground">
              <time
                dateTime={invite.expires_at}
                title={formatAbsoluteTime(invite.expires_at)}
              >
                {formatRelativeTime(invite.expires_at)}
              </time>
            </td>
            <td className="max-w-44 px-4 py-3">
              <span
                className="block truncate text-muted-foreground"
                title={invite.created_by_name ?? undefined}
              >
                {invite.created_by_name ?? '—'}
              </span>
            </td>
            <td className="px-4 py-2 text-right">
              {canManage(actorRole, invite.role) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRevoke(invite)}
                >
                  Revoke
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
