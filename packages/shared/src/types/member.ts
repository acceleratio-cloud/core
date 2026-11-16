/** `viewer` is shown as "Read only"; `custom` grants access per project. */
export type MemberRole = 'owner' | 'admin' | 'viewer' | 'custom';

/** Ordered: `delete` ("Full") includes `edit`, which includes `read`. */
export type ProjectAccessLevel = 'read' | 'edit' | 'delete';

/** What the signed-in member may do. `projects` is null for built-in roles. */
export interface MemberAccess {
  role: MemberRole;
  role_id: string | null;
  projects: Record<string, ProjectAccessLevel> | null;
}

/** An account. `role` is null when the account has no access (orphaned). */
export interface Member {
  user_id: string;
  name: string;
  email: string;
  role: MemberRole | null;
  role_id: string | null;
  role_name: string | null;
  created_at: string;
}

export interface UpdateMemberPayload {
  role: Exclude<MemberRole, 'owner'>;
  role_id?: string | null;
}

export interface CustomRoleProject {
  project_id: string;
  project_name: string;
  access: ProjectAccessLevel;
}

export interface CustomRole {
  id: string;
  name: string;
  projects: CustomRoleProject[];
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface CustomRolePayload {
  name: string;
  projects: { project_id: string; access: ProjectAccessLevel }[];
}

export interface Invite {
  id: string;
  role: Exclude<MemberRole, 'owner'>;
  role_id: string | null;
  role_name: string | null;
  /** 1 for a personal link; null for a link anyone may use until it expires. */
  max_uses: number | null;
  use_count: number;
  expires_at: string;
  created_by_name: string | null;
  created_at: string;
}

export interface CreateInvitePayload {
  role: Exclude<MemberRole, 'owner'>;
  role_id?: string | null;
  max_uses: 1 | null;
}

/** The token is returned only once; only its hash is stored. */
export interface CreatedInvite {
  invite: Invite;
  token: string;
}

/** What an invite link shows before the account is created. */
export interface InvitePreview {
  role: Exclude<MemberRole, 'owner'>;
  role_name: string | null;
  expires_at: string;
}

export interface AcceptInvitePayload {
  name: string;
  email: string;
  password: string;
}
