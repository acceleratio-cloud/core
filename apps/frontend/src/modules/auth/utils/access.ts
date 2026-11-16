import type { MemberAccess, ProjectAccessLevel } from '@acceleratio/shared';

const LEVELS: ProjectAccessLevel[] = ['read', 'edit', 'delete'];

/** Mirrors the API's rule; the API stays the one that enforces it. */
export const projectLevel = (
  access: MemberAccess | null,
  projectId: string,
): ProjectAccessLevel | null => {
  switch (access?.role) {
    case 'owner':
    case 'admin':
      return 'delete';
    case 'viewer':
      return 'read';
    case 'custom':
      return access.projects?.[projectId] ?? null;
    default:
      return null;
  }
};

export const canProject = (
  access: MemberAccess | null,
  projectId: string,
  level: ProjectAccessLevel,
): boolean => {
  const have = projectLevel(access, projectId);

  return have !== null && LEVELS.indexOf(have) >= LEVELS.indexOf(level);
};

/** Owner and admins: create projects, change the cluster, manage people. */
export const isManager = (access: MemberAccess | null): boolean =>
  access?.role === 'owner' || access?.role === 'admin';

/** Custom roles see only their projects, not the installation. */
export const isCustom = (access: MemberAccess | null): boolean =>
  access?.role === 'custom';
