import type { MemberRole } from '@acceleratio/shared';
import { CircleSlash } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ROLE_ICONS, roleLabel } from '../roles';

/** A member's or invite's role. `null` is an account without a member row. */
export const RoleBadge = ({
  role,
  name,
}: {
  role: MemberRole | null;
  name: string | null;
}) => {
  const Icon = role ? ROLE_ICONS[role] : CircleSlash;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium',
        role === null ? 'text-status-warning' : 'text-fg-secondary',
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3 shrink-0"
      />
      <span className="truncate">{roleLabel(role, name)}</span>
    </span>
  );
};
