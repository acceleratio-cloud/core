import type { MemberRole, ProjectAccessLevel } from '@acceleratio/shared';
import {
  Crown,
  Eye,
  KeyRound,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export type GrantableRole = Exclude<MemberRole, 'owner'>;

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  viewer: 'Read only',
  custom: 'Custom',
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: 'Everything, including managing admins and transferring ownership.',
  admin: 'Everything except managing the owner and admins.',
  viewer: 'Sees every project and the cluster; changes nothing.',
  custom: 'Only the projects a custom role grants.',
};

export const ROLE_ICONS: Record<MemberRole, LucideIcon> = {
  owner: Crown,
  admin: ShieldCheck,
  viewer: Eye,
  custom: KeyRound,
};

export const LEVEL_LABELS: Record<ProjectAccessLevel, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Full',
};

export const LEVEL_DESCRIPTIONS: Record<ProjectAccessLevel, string> = {
  read: 'Status, logs and settings, without secrets',
  edit: 'Change and deploy services, see secrets',
  delete: 'Edit, and delete services or the project',
};

/** Mirrors the API: only the owner manages admins; nobody grants owner. */
export const grantableRoles = (actor: MemberRole | undefined): GrantableRole[] =>
  actor === 'owner'
    ? ['admin', 'viewer', 'custom']
    : actor === 'admin'
      ? ['viewer', 'custom']
      : [];

export const canManage = (
  actor: MemberRole | undefined,
  target: MemberRole | null,
): boolean =>
  target !== 'owner' && grantableRoles(actor).includes(target ?? 'viewer');

export const roleLabel = (
  role: MemberRole | null,
  customName: string | null,
): string =>
  role === null
    ? 'No access'
    : role === 'custom' && customName
      ? customName
      : ROLE_LABELS[role];
