import type { CustomRole, Member } from '@acceleratio/shared';
import type { ReactNode } from 'react';
import { KeyRound, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { buttonVariants } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  LEVEL_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_ICONS,
  ROLE_LABELS,
} from '../roles';
import { EmptyPanel } from './empty-panel';

const BUILT_IN = ['owner', 'admin', 'viewer'] as const;
/** Grants listed on a card; the rest are counted. */
const VISIBLE_GRANTS = 5;
const MENU_ICON = 'size-3.5 text-muted-foreground';

const pluralMembers = (count: number) =>
  `${count} ${count === 1 ? 'member' : 'members'}`;

const RoleCard = ({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <article className="panel-lit flex min-w-0 flex-col rounded-xl p-4">
    <header className="flex min-h-7 items-center gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-panel text-fg-secondary">
        {icon}
      </span>
      <h3
        className="min-w-0 truncate text-sm font-medium text-foreground"
        title={title}
      >
        {title}
      </h3>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
        {pluralMembers(count)}
      </span>
      {action}
    </header>
    {children}
  </article>
);

const SectionHeading = ({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 id={id} className="text-[13px] font-medium text-foreground">
        {title}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
    {action}
  </div>
);

export const RolesGrid = ({
  members,
  roles,
  createAction,
  onEdit,
  onDelete,
}: {
  members: Member[];
  roles: CustomRole[];
  /** The create button; absent for roles that cannot manage. */
  createAction?: ReactNode;
  onEdit?: (role: CustomRole) => void;
  onDelete?: (role: CustomRole) => void;
}) => (
  <div className="flex flex-col gap-8">
    <section aria-labelledby="roles-built-in" className="flex flex-col gap-3">
      <SectionHeading
        id="roles-built-in"
        title="Built-in roles"
        description="Installation-wide. They can't be changed."
      />
      <div className="grid gap-3 md:grid-cols-3">
        {BUILT_IN.map((role) => {
          const Icon = ROLE_ICONS[role];

          return (
            <RoleCard
              key={role}
              icon={
                <Icon
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3.5"
                />
              }
              title={ROLE_LABELS[role]}
              count={members.filter((member) => member.role === role).length}
            >
              <p className="mt-3 text-[13px] text-fg-secondary">
                {ROLE_DESCRIPTIONS[role]}
              </p>
            </RoleCard>
          );
        })}
      </div>
    </section>

    <section aria-labelledby="roles-custom" className="flex flex-col gap-3">
      <SectionHeading
        id="roles-custom"
        title="Custom roles"
        description="Access to chosen projects only. Members with a custom role don't see the cluster, other projects or this page."
        action={roles.length > 0 ? createAction : undefined}
      />
      {roles.length === 0 ? (
        <EmptyPanel
          icon={KeyRound}
          title="No custom roles"
          description="Give someone Read, Edit or Full access to some projects and nothing else."
          action={createAction}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => {
            const hidden = role.projects.length - VISIBLE_GRANTS;

            return (
              <RoleCard
                key={role.id}
                icon={
                  <KeyRound
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="size-3.5"
                  />
                }
                title={role.name}
                count={role.member_count}
                action={
                  onEdit && onDelete ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Actions for ${role.name}`}
                        className={buttonVariants({
                          variant: 'ghost',
                          size: 'icon-sm',
                          className: '-my-1 -mr-1.5',
                        })}
                      >
                        <MoreHorizontal
                          aria-hidden="true"
                          strokeWidth={1.75}
                          className="size-4"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40 min-w-40">
                        <DropdownMenuItem onClick={() => onEdit(role)}>
                          <Pencil
                            aria-hidden="true"
                            strokeWidth={1.75}
                            className={MENU_ICON}
                          />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onDelete(role)}
                          className="text-destructive data-highlighted:text-destructive"
                        >
                          <Trash2
                            aria-hidden="true"
                            strokeWidth={1.75}
                            className="size-3.5"
                          />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : undefined
                }
              >
                {role.projects.length === 0 ? (
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    No projects granted yet.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-panel">
                    {role.projects.slice(0, VISIBLE_GRANTS).map((grant) => (
                      <li
                        key={grant.project_id}
                        className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]"
                      >
                        <span
                          className="min-w-0 truncate text-foreground"
                          title={grant.project_name}
                        >
                          {grant.project_name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {LEVEL_LABELS[grant.access]}
                        </span>
                      </li>
                    ))}
                    {hidden > 0 ? (
                      <li className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                        +{hidden} more {hidden === 1 ? 'project' : 'projects'}
                      </li>
                    ) : null}
                  </ul>
                )}
              </RoleCard>
            );
          })}
        </div>
      )}
    </section>
  </div>
);
