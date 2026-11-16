import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type {
  CreateInvitePayload,
  CreatedInvite,
  CustomRole,
  CustomRolePayload,
  Invite,
  InvitePreview,
  Member,
  MemberRole,
  ProjectAccessLevel,
  UpdateMemberPayload,
} from '@acceleratio/shared';
import { isUuid, normalizeName } from '@/common/validation';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { session, user } from '@/vendor/db/schema';
import { project } from '@/application/project/schemas/project.schema';
import { LEVELS, type Access } from './access';
import { AccessService } from './access.service';
import {
  customRole,
  customRoleProject,
  invite,
  member,
  type InviteRow,
} from './schemas/member.schema';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVALID_INVITE_MESSAGE =
  'This invite link is invalid or has expired';
export const SETUP_DONE_MESSAGE = 'Initial setup has already been completed';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const GRANTABLE: MemberRole[] = ['admin', 'viewer', 'custom'];
const OWNER_CHANGE_MESSAGE = 'The owner changes only by transferring ownership';

type GrantableRole = Exclude<MemberRole, 'owner'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Who may grant, change or remove which role. `target` is the role the
 * account has now (null for none), `next` the role it would get.
 */
export const assertCanManage = (
  actor: MemberRole,
  target: MemberRole | null,
  next?: MemberRole,
): void => {
  if (actor !== 'owner' && actor !== 'admin') {
    throw new ForbiddenException('Only the owner and admins can manage users');
  }

  if (target === 'owner' || next === 'owner') {
    throw new ForbiddenException(OWNER_CHANGE_MESSAGE);
  }

  if ((target === 'admin' || next === 'admin') && actor !== 'owner') {
    throw new ForbiddenException('Only the owner can manage admins');
  }
};

/** The roles an account with `role` may hand out in an invite. */
const invitableBy = (role: MemberRole): MemberRole[] =>
  role === 'owner' ? GRANTABLE : role === 'admin' ? ['viewer', 'custom'] : [];

/** The PostgreSQL error code, which Drizzle wraps in `cause`. */
const pgCode = (error: unknown): unknown => {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;

    if (typeof code === 'string' && /^\d{5}$/.test(code)) {
      return code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
};

@Injectable()
export class MemberService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: AccessService,
  ) {}

  /** Every account (or one), with no role for one that has no access. */
  async list(userId?: string): Promise<Member[]> {
    const rows = await this.db
      .select({
        user_id: user.id,
        name: user.name,
        email: user.email,
        role: member.role,
        role_id: member.role_id,
        role_name: customRole.name,
        created_at: user.createdAt,
      })
      .from(user)
      .leftJoin(member, eq(member.user_id, user.id))
      .leftJoin(customRole, eq(customRole.id, member.role_id))
      .where(userId === undefined ? undefined : eq(user.id, userId))
      .orderBy(asc(user.createdAt));

    return rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
    }));
  }

  async update(
    actor: Access,
    userId: string,
    payload: UpdateMemberPayload,
  ): Promise<Member> {
    const { role, roleId } = await this.normalizeGrant(payload);
    const target = await this.roleOf(userId);

    assertCanManage(actor.role, target, role);

    // The condition holds even if a transfer made them the owner meanwhile.
    const [saved] = await this.db
      .insert(member)
      .values({ user_id: userId, role, role_id: roleId })
      .onConflictDoUpdate({
        target: member.user_id,
        set: { role, role_id: roleId },
        setWhere: ne(member.role, 'owner'),
      })
      .returning({ user_id: member.user_id });

    if (!saved) {
      throw new ForbiddenException(OWNER_CHANGE_MESSAGE);
    }

    await this.dropInvitesBeyond(userId, role);
    this.access.notify([userId]);

    return (await this.list(userId))[0];
  }

  /** Deletes the account: its sessions, password and access go with it. */
  async remove(actor: Access, userId: string): Promise<void> {
    assertCanManage(actor.role, await this.roleOf(userId));

    const [removed] = await this.db
      .delete(user)
      .where(
        and(
          eq(user.id, userId),
          // Not the owner, even one made so by a transfer since the check.
          sql`not exists (select 1 from ${member} where ${member.user_id} = ${userId} and ${member.role} = 'owner')`,
        ),
      )
      .returning({ id: user.id });

    if (!removed) {
      throw new ForbiddenException(OWNER_CHANGE_MESSAGE);
    }

    this.access.notify([userId]);
  }

  /** The owner becomes an admin and the target the owner, in one step. */
  async transferOwnership(actor: Access, userId: string): Promise<void> {
    if (actor.role !== 'owner') {
      throw new ForbiddenException('Only the owner can do this');
    }

    if (userId === actor.userId) {
      throw new BadRequestException('You already own this installation');
    }

    if ((await this.roleOf(userId)) === null) {
      throw new BadRequestException('This account has no access yet');
    }

    // Demote first: the database allows only one owner at a time. Either
    // step finding no row (a concurrent change) rolls both back.
    await this.db.transaction(async (tx) => {
      const demoted = await tx
        .update(member)
        .set({ role: 'admin', role_id: null })
        .where(and(eq(member.user_id, actor.userId), eq(member.role, 'owner')))
        .returning({ user_id: member.user_id });

      if (demoted.length === 0) {
        throw new ForbiddenException('Only the owner can do this');
      }

      const promoted = await tx
        .update(member)
        .set({ role: 'owner', role_id: null })
        .where(eq(member.user_id, userId))
        .returning({ user_id: member.user_id });

      if (promoted.length === 0) {
        throw new BadRequestException('This account has no access yet');
      }
    });

    await this.dropInvitesBeyond(actor.userId, 'admin');
    this.access.notify([actor.userId, userId]);
  }

  /** Installation: the first account becomes the owner. */
  async addOwner(userId: string): Promise<void> {
    try {
      await this.db.insert(member).values({ user_id: userId, role: 'owner' });
    } catch (error) {
      if (pgCode(error) === UNIQUE_VIOLATION) {
        throw new ForbiddenException(SETUP_DONE_MESSAGE);
      }
      throw error;
    }
  }

  async addFromInvite(userId: string, row: InviteRow): Promise<void> {
    try {
      await this.db
        .insert(member)
        .values({ user_id: userId, role: row.role, role_id: row.role_id });
    } catch (error) {
      // Its custom role was deleted after the link was claimed.
      if (pgCode(error) === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException(INVALID_INVITE_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Refuses an account that has a password but no access (its setup failed
   * half way) and ends the session its sign-in just opened.
   */
  async assertMember(userId: string): Promise<void> {
    const [row] = await this.db
      .select({ user_id: member.user_id })
      .from(member)
      .where(eq(member.user_id, userId));

    if (!row) {
      await this.db.delete(session).where(eq(session.userId, userId));
      throw new ForbiddenException(
        'This account has no access. Ask an admin for a new invite.',
      );
    }
  }

  /** Undoes an account whose setup failed half way. */
  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(user).where(eq(user.id, userId));
  }

  async listRoles(id?: string): Promise<CustomRole[]> {
    const [roles, grants, counts] = await Promise.all([
      this.db
        .select()
        .from(customRole)
        .where(id === undefined ? undefined : eq(customRole.id, id))
        .orderBy(asc(customRole.name)),
      this.db
        .select({
          role_id: customRoleProject.role_id,
          project_id: customRoleProject.project_id,
          project_name: project.name,
          access: customRoleProject.access,
        })
        .from(customRoleProject)
        .innerJoin(project, eq(project.id, customRoleProject.project_id))
        .where(id === undefined ? undefined : eq(customRoleProject.role_id, id))
        .orderBy(asc(project.name)),
      this.db
        .select({ role_id: member.role_id, count: count() })
        .from(member)
        .where(
          id === undefined ? isNotNull(member.role_id) : eq(member.role_id, id),
        )
        .groupBy(member.role_id),
    ]);

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      projects: grants
        .filter((grant) => grant.role_id === role.id)
        .map(({ project_id, project_name, access }) => ({
          project_id,
          project_name,
          access,
        })),
      member_count: counts.find((item) => item.role_id === role.id)?.count ?? 0,
      created_at: role.created_at.toISOString(),
      updated_at: role.updated_at.toISOString(),
    }));
  }

  async createRole(payload: CustomRolePayload): Promise<CustomRole> {
    const { name, grants } = this.normalizeRole(payload);

    const id = await this.saveRole(async (tx) => {
      const [row] = await tx
        .insert(customRole)
        .values({ name })
        .returning({ id: customRole.id });
      await this.insertGrants(tx, row.id, grants);
      return row.id;
    });

    return this.getRole(id);
  }

  async updateRole(
    id: string,
    payload: CustomRolePayload,
  ): Promise<CustomRole> {
    const { name, grants } = this.normalizeRole(payload);

    await this.saveRole(async (tx) => {
      const [row] = await tx
        .update(customRole)
        .set({ name })
        .where(eq(customRole.id, id))
        .returning({ id: customRole.id });

      if (!row) {
        throw new NotFoundException('Role not found');
      }

      await tx
        .delete(customRoleProject)
        .where(eq(customRoleProject.role_id, id));
      await this.insertGrants(tx, id, grants);
    });

    this.access.notify(await this.holdersOf(id));

    return this.getRole(id);
  }

  async removeRole(id: string): Promise<void> {
    const holders = await this.holdersOf(id);

    if (holders.length > 0) {
      throw new ConflictException(
        `Role is assigned to ${holders.length} ${holders.length === 1 ? 'member' : 'members'}`,
      );
    }

    // Its pending invites go with it.
    const [row] = await this.db
      .delete(customRole)
      .where(eq(customRole.id, id))
      .returning({ id: customRole.id })
      .catch((error: unknown) => {
        // Assigned to someone after the check above.
        if (pgCode(error) === FOREIGN_KEY_VIOLATION) {
          throw new ConflictException('Role is assigned to members');
        }
        throw error;
      });

    if (!row) {
      throw new NotFoundException('Role not found');
    }
  }

  /** Usable invites (or one): expired and used-up links are left out. */
  async listInvites(id?: string): Promise<Invite[]> {
    const rows = await this.db
      .select({
        invite,
        role_name: customRole.name,
        created_by_name: user.name,
      })
      .from(invite)
      .leftJoin(customRole, eq(customRole.id, invite.role_id))
      .leftJoin(user, eq(user.id, invite.created_by))
      .where(
        and(this.usable(), id === undefined ? undefined : eq(invite.id, id)),
      )
      .orderBy(asc(invite.created_at));

    return rows.map((row) =>
      this.toInvite(row.invite, row.role_name, row.created_by_name),
    );
  }

  async createInvite(
    actor: Access,
    payload: CreateInvitePayload,
  ): Promise<CreatedInvite> {
    const { role, roleId } = await this.normalizeGrant(payload);

    assertCanManage(actor.role, null, role);

    if (payload.max_uses !== 1 && payload.max_uses !== null) {
      throw new BadRequestException(
        'An invite is either for one person or for anyone with the link',
      );
    }

    await this.pruneInvites();

    const token = randomBytes(32).toString('base64url');
    const [row] = await this.db
      .insert(invite)
      .values({
        token_hash: hashToken(token),
        role,
        role_id: roleId,
        max_uses: payload.max_uses,
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
        created_by: actor.userId,
      })
      .returning();

    return { invite: (await this.listInvites(row.id))[0], token };
  }

  async revokeInvite(actor: Access, id: string): Promise<void> {
    const [row] = await this.db
      .select({ role: invite.role })
      .from(invite)
      .where(eq(invite.id, id));

    if (!row) {
      throw new NotFoundException('Invite not found');
    }

    assertCanManage(actor.role, null, row.role);

    await this.db.delete(invite).where(eq(invite.id, id));
  }

  async previewInvite(token: string): Promise<InvitePreview> {
    const [row] = await this.db
      .select({
        role: invite.role,
        role_name: customRole.name,
        expires_at: invite.expires_at,
      })
      .from(invite)
      .leftJoin(customRole, eq(customRole.id, invite.role_id))
      .where(and(eq(invite.token_hash, hashToken(token)), this.usable()));

    if (!row) {
      throw new NotFoundException(INVALID_INVITE_MESSAGE);
    }

    return {
      role: row.role as GrantableRole,
      role_name: row.role_name,
      expires_at: row.expires_at.toISOString(),
    };
  }

  /** Takes one use of the link atomically; null when it is spent or gone. */
  async claimInvite(token: string): Promise<InviteRow | null> {
    const [row] = await this.db
      .update(invite)
      .set({ use_count: sql`${invite.use_count} + 1` })
      .where(and(eq(invite.token_hash, hashToken(token)), this.usable()))
      .returning();

    return row ?? null;
  }

  /** Gives back a use taken by an account that could not be created. */
  async releaseInvite(id: string): Promise<void> {
    await this.db
      .update(invite)
      .set({ use_count: sql`greatest(${invite.use_count} - 1, 0)` })
      .where(eq(invite.id, id));
  }

  private usable() {
    return and(
      gt(invite.expires_at, new Date()),
      or(isNull(invite.max_uses), lt(invite.use_count, invite.max_uses)),
    );
  }

  private async pruneInvites(): Promise<void> {
    await this.db
      .delete(invite)
      .where(
        or(
          lt(invite.expires_at, new Date()),
          and(
            isNotNull(invite.max_uses),
            gte(invite.use_count, invite.max_uses),
          ),
        ),
      );
  }

  /** A demoted account's links stop granting what it can no longer grant. */
  private async dropInvitesBeyond(
    userId: string,
    role: MemberRole,
  ): Promise<void> {
    const allowed = invitableBy(role);

    await this.db
      .delete(invite)
      .where(
        and(
          eq(invite.created_by, userId),
          allowed.length > 0 ? notInArray(invite.role, allowed) : undefined,
        ),
      );
  }

  private async roleOf(userId: string): Promise<MemberRole | null> {
    const [row] = await this.db
      .select({ role: member.role })
      .from(user)
      .leftJoin(member, eq(member.user_id, user.id))
      .where(eq(user.id, userId));

    if (!row) {
      throw new NotFoundException('User not found');
    }

    return row.role;
  }

  private async holdersOf(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ user_id: member.user_id })
      .from(member)
      .where(eq(member.role_id, roleId));

    return rows.map((row) => row.user_id);
  }

  private async getRole(id: string): Promise<CustomRole> {
    const [role] = await this.listRoles(id);

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  private async normalizeGrant(payload: {
    role?: unknown;
    role_id?: unknown;
  }): Promise<{ role: GrantableRole; roleId: string | null }> {
    const role = payload?.role;

    if (typeof role !== 'string' || !GRANTABLE.includes(role as MemberRole)) {
      throw new BadRequestException('Role must be admin, viewer or custom');
    }

    if (role !== 'custom') {
      return { role: role as GrantableRole, roleId: null };
    }

    const roleId = payload.role_id;

    if (!isUuid(roleId)) {
      throw new BadRequestException('Choose a custom role');
    }

    const [row] = await this.db
      .select({ id: customRole.id })
      .from(customRole)
      .where(eq(customRole.id, roleId));

    if (!row) {
      throw new BadRequestException('Role not found');
    }

    return { role: 'custom', roleId };
  }

  private normalizeRole(payload: CustomRolePayload): {
    name: string;
    grants: Map<string, ProjectAccessLevel>;
  } {
    const name = normalizeName(payload?.name);

    if (!Array.isArray(payload?.projects)) {
      throw new BadRequestException('Projects must be a list');
    }

    const grants = new Map<string, ProjectAccessLevel>();

    for (const item of payload.projects as unknown[]) {
      const grant = item as { project_id?: unknown; access?: unknown };

      if (!isUuid(grant?.project_id)) {
        throw new BadRequestException('Project not found');
      }

      if (!LEVELS.includes(grant.access as ProjectAccessLevel)) {
        throw new BadRequestException('Access must be read, edit or delete');
      }

      grants.set(grant.project_id, grant.access as ProjectAccessLevel);
    }

    return { name, grants };
  }

  private async saveRole<T>(
    write: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.transaction(write);
    } catch (error) {
      if (pgCode(error) === UNIQUE_VIOLATION) {
        throw new ConflictException('A role with this name already exists');
      }

      if (pgCode(error) === FOREIGN_KEY_VIOLATION) {
        throw new BadRequestException('Project not found');
      }

      throw error;
    }
  }

  private async insertGrants(
    tx: Transaction,
    roleId: string,
    grants: Map<string, ProjectAccessLevel>,
  ): Promise<void> {
    if (grants.size === 0) {
      return;
    }

    await tx.insert(customRoleProject).values(
      [...grants].map(([project_id, access]) => ({
        role_id: roleId,
        project_id,
        access,
      })),
    );
  }

  private toInvite(
    row: InviteRow,
    roleName: string | null,
    createdByName: string | null,
  ): Invite {
    return {
      id: row.id,
      role: row.role as GrantableRole,
      role_id: row.role_id,
      role_name: roleName,
      max_uses: row.max_uses,
      use_count: row.use_count,
      expires_at: row.expires_at.toISOString(),
      created_by_name: createdByName,
      created_at: row.created_at.toISOString(),
    };
  }
}
