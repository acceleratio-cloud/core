import {
  createParamDecorator,
  ForbiddenException,
  NotFoundException,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type {
  MemberAccess,
  MemberRole,
  ProjectAccessLevel,
} from '@acceleratio/shared';

/** What a signed-in account may do, read from the database per request. */
export interface Access {
  userId: string;
  role: MemberRole;
  roleId: string | null;
  /** Grants of a custom role; null for the built-in roles. */
  projects: Map<string, ProjectAccessLevel> | null;
}

/**
 * - `member`: any account with access.
 * - `viewer`: every built-in role (owner, admin, read only), no custom role.
 * - `admin`: owner and admins. `owner`: the owner only.
 * - `{ project }`: at least this level on the `:projectId` of the route.
 */
export type AccessRule =
  'member' | 'viewer' | 'admin' | 'owner' | { project: ProjectAccessLevel };

export const ACCESS_RULE = 'ACCESS_RULE';

export const LEVELS: ProjectAccessLevel[] = ['read', 'edit', 'delete'];

const DENIED: Record<ProjectAccessLevel, string> = {
  read: 'Project not found',
  edit: "Your role can't change this project or see its secrets",
  delete: "Your role can't delete in this project",
};

/** Overrides the rule derived from the method and the `:projectId` param. */
export const RequireAccess = (rule: AccessRule) =>
  SetMetadata(ACCESS_RULE, rule);

/** The caller's access, set by `AccessGuard`. */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Access =>
    context.switchToHttp().getRequest<{ access: Access }>().access,
);

export const isManager = (access: Access): boolean =>
  access.role === 'owner' || access.role === 'admin';

export const projectLevel = (
  access: Access,
  projectId: string,
): ProjectAccessLevel | null => {
  switch (access.role) {
    case 'owner':
    case 'admin':
      return 'delete';
    case 'viewer':
      return 'read';
    default:
      return access.projects?.get(projectId) ?? null;
  }
};

export const allows = (
  access: Access,
  projectId: string,
  level: ProjectAccessLevel,
): boolean => {
  const have = projectLevel(access, projectId);

  return have !== null && LEVELS.indexOf(have) >= LEVELS.indexOf(level);
};

/** 404 when the project is out of reach, 403 when the level is too low. */
export const assertProject = (
  access: Access,
  projectId: string,
  level: ProjectAccessLevel,
): void => {
  if (projectLevel(access, projectId) === null) {
    throw new NotFoundException('Project not found');
  }

  if (!allows(access, projectId, level)) {
    throw new ForbiddenException(DENIED[level]);
  }
};

export const assertManager = (access: Access): void => {
  if (!isManager(access)) {
    throw new ForbiddenException('Only the owner and admins can do this');
  }
};

/** Reads need `read`, everything else `edit`; installation routes need a built-in role. */
export const defaultRule = (
  method: string,
  projectId: string | undefined,
): AccessRule => {
  const read = method === 'GET' || method === 'HEAD';

  if (projectId !== undefined) {
    return { project: read ? 'read' : 'edit' };
  }

  return read ? 'viewer' : 'admin';
};

export const enforce = (
  access: Access,
  rule: AccessRule,
  projectId: string | undefined,
): void => {
  if (rule === 'member') {
    return;
  }

  if (typeof rule === 'object') {
    if (projectId === undefined) {
      // A project rule on a route without :projectId is a wiring mistake.
      throw new ForbiddenException("Your role can't do this");
    }

    return assertProject(access, projectId, rule.project);
  }

  if (rule === 'viewer' && access.role === 'custom') {
    throw new ForbiddenException("Your role can't access this");
  }

  if (rule === 'admin') {
    assertManager(access);
  }

  if (rule === 'owner' && access.role !== 'owner') {
    throw new ForbiddenException('Only the owner can do this');
  }
};

export const toMemberAccess = (access: Access): MemberAccess => ({
  role: access.role,
  role_id: access.roleId,
  projects: access.projects ? Object.fromEntries(access.projects) : null,
});
