import type { Member, MemberRole } from '@acceleratio/shared';
import { Crown, MoreHorizontal, ShieldCheck, Trash2 } from 'lucide-react';

import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar';
import { buttonVariants } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { canManage } from '../roles';
import { RoleBadge } from './role-badge';

const MENU_ICON = 'size-3.5 text-muted-foreground';

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';

export const MembersTable = ({
  members,
  selfId,
  actorRole,
  onChangeRole,
  onTransfer,
  onRemove,
}: {
  members: Member[];
  selfId: string | undefined;
  actorRole: MemberRole | undefined;
  onChangeRole: (member: Member) => void;
  onTransfer: (member: Member) => void;
  onRemove: (member: Member) => void;
}) => (
  <div className="relative overflow-x-auto rounded-xl border border-border bg-surface-raised">
    <table className="w-full min-w-[36rem] text-left text-sm">
      <caption className="sr-only">Members</caption>
      <thead className="border-b border-border bg-surface-panel text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="px-4 py-2.5 font-medium">
            Member
          </th>
          <th scope="col" className="w-48 px-4 py-2.5 font-medium">
            Role
          </th>
          <th scope="col" className="w-36 px-4 py-2.5 font-medium">
            Joined
          </th>
          <th scope="col" className="w-14 px-4 py-2.5">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {members.map((member) => {
          const self = member.user_id === selfId;
          const manageable = !self && canManage(actorRole, member.role);
          const transferable =
            !self && actorRole === 'owner' && member.role !== null;

          return (
            <tr
              key={member.user_id}
              className="transition-colors hover:bg-surface-muted/40"
            >
              <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar>
                    <AvatarFallback className="bg-surface-muted">
                      {initials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-2">
                      <span
                        className="truncate font-medium text-foreground"
                        title={member.name}
                      >
                        {member.name}
                      </span>
                      {self ? (
                        <span className="shrink-0 rounded-full border border-border px-1.5 text-[11px] leading-4 font-medium text-muted-foreground">
                          You
                        </span>
                      ) : null}
                    </p>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={member.email}
                    >
                      {member.email}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <RoleBadge role={member.role} name={member.role_name} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <time
                  dateTime={member.created_at}
                  title={formatAbsoluteTime(member.created_at)}
                >
                  {formatRelativeTime(member.created_at)}
                </time>
              </td>
              <td className="px-4 py-2 text-right">
                {manageable || transferable ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Actions for ${member.name}`}
                      className={buttonVariants({
                        variant: 'ghost',
                        size: 'icon-sm',
                      })}
                    >
                      <MoreHorizontal
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="size-4"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52 min-w-52">
                      {manageable ? (
                        <DropdownMenuItem onClick={() => onChangeRole(member)}>
                          <ShieldCheck
                            aria-hidden="true"
                            strokeWidth={1.75}
                            className={MENU_ICON}
                          />
                          Change role
                        </DropdownMenuItem>
                      ) : null}
                      {transferable ? (
                        <DropdownMenuItem onClick={() => onTransfer(member)}>
                          <Crown
                            aria-hidden="true"
                            strokeWidth={1.75}
                            className={MENU_ICON}
                          />
                          Transfer ownership
                        </DropdownMenuItem>
                      ) : null}
                      {manageable ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onRemove(member)}
                            className="text-destructive data-highlighted:text-destructive"
                          >
                            <Trash2
                              aria-hidden="true"
                              strokeWidth={1.75}
                              className="size-3.5"
                            />
                            Remove
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
