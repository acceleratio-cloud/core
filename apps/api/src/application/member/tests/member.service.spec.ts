import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { MemberRole } from '@acceleratio/shared';
import type { Database } from '@/vendor/db/database.constants';
import type { Access } from '../access';
import type { AccessService } from '../access.service';
import { assertCanManage, hashToken, MemberService } from '../member.service';

describe('assertCanManage', () => {
  const allowed = (
    actor: MemberRole,
    target: MemberRole | null,
    next?: MemberRole,
  ) => {
    try {
      assertCanManage(actor, target, next);
      return true;
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      return false;
    }
  };

  it('lets only the owner and admins manage people', () => {
    expect(allowed('viewer', 'custom', 'viewer')).toBe(false);
    expect(allowed('custom', null, 'viewer')).toBe(false);
  });

  it('never grants, changes or removes the owner', () => {
    expect(allowed('owner', 'viewer', 'owner')).toBe(false);
    expect(allowed('owner', 'owner', 'admin')).toBe(false);
    expect(allowed('owner', 'owner')).toBe(false);
  });

  it('leaves admins to the owner', () => {
    expect(allowed('owner', 'viewer', 'admin')).toBe(true);
    expect(allowed('owner', 'admin', 'viewer')).toBe(true);
    expect(allowed('admin', 'viewer', 'admin')).toBe(false);
    expect(allowed('admin', 'admin', 'viewer')).toBe(false);
    expect(allowed('admin', 'admin')).toBe(false);
  });

  it('lets admins manage read only and custom members', () => {
    expect(allowed('admin', 'viewer', 'custom')).toBe(true);
    expect(allowed('admin', 'custom')).toBe(true);
    expect(allowed('admin', null, 'viewer')).toBe(true);
  });
});

describe('MemberService', () => {
  const owner: Access = {
    userId: 'owner-1',
    role: 'owner',
    roleId: null,
    projects: null,
  };

  /** A select chain that resolves to `rows` however it is built. */
  const selecting = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const key of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy']) {
      chain[key] = () => chain;
    }
    chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
    return chain;
  };

  const create = (db: Record<string, unknown>) => {
    const notify = jest.fn();
    const service = new MemberService(
      db as unknown as Database,
      { notify } as unknown as AccessService,
    );
    return { service, notify };
  };

  it('stores only a hash of the invite token', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).not.toContain('abc');
  });

  /** A transaction whose updates return `results` in turn. */
  const transacting = (results: unknown[][]) => {
    const updates: unknown[] = [];
    const tx = {
      update: () => ({
        set: (set: unknown) => ({
          where: () => ({
            returning: () => {
              updates.push(set);
              return Promise.resolve(results[updates.length - 1]);
            },
          }),
        }),
      }),
    };
    return {
      updates,
      transaction: (run: (t: typeof tx) => Promise<void>) => run(tx),
    };
  };

  it('demotes the owner before promoting the next one', async () => {
    const { updates, transaction } = transacting([
      [{ user_id: 'owner-1' }],
      [{ user_id: 'admin-1' }],
    ]);
    const dropInvites = jest.fn().mockResolvedValue(undefined);
    const { service, notify } = create({
      select: () => selecting([{ role: 'admin' }]),
      transaction,
      delete: () => ({ where: dropInvites }),
    });

    await service.transferOwnership(owner, 'admin-1');

    expect(updates).toEqual([
      { role: 'admin', role_id: null },
      { role: 'owner', role_id: null },
    ]);
    // The former owner's admin invites stop working.
    expect(dropInvites).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(['owner-1', 'admin-1']);
  });

  it('fails the transfer when the next owner is gone meanwhile', async () => {
    const { transaction } = transacting([[{ user_id: 'owner-1' }], []]);
    const { service, notify } = create({
      select: () => selecting([{ role: 'admin' }]),
      transaction,
    });

    await expect(
      service.transferOwnership(owner, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notify).not.toHaveBeenCalled();
  });

  /** An upsert that returns `rows`. */
  const inserting = (rows: unknown[]) => () => ({
    values: () => ({
      onConflictDoUpdate: () => ({ returning: () => Promise.resolve(rows) }),
    }),
  });

  it('refuses to change an account that became the owner meanwhile', async () => {
    const { service, notify } = create({
      select: () => selecting([{ role: 'viewer' }]),
      insert: inserting([]),
    });

    await expect(
      service.update(owner, 'user-1', { role: 'admin', role_id: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(notify).not.toHaveBeenCalled();
  });

  it('drops the invites a demoted admin could no longer create', async () => {
    const dropInvites = jest.fn().mockResolvedValue(undefined);
    const select = jest
      .fn()
      .mockReturnValueOnce(selecting([{ role: 'admin' }]))
      .mockReturnValueOnce(
        selecting([
          {
            user_id: 'admin-1',
            name: 'Ada',
            email: 'ada@example.com',
            role: 'viewer',
            role_id: null,
            role_name: null,
            created_at: new Date(0),
          },
        ]),
      );
    const { service, notify } = create({
      select,
      insert: inserting([{ user_id: 'admin-1' }]),
      delete: () => ({ where: dropInvites }),
    });

    await expect(
      service.update(owner, 'admin-1', { role: 'viewer', role_id: null }),
    ).resolves.toMatchObject({ user_id: 'admin-1', role: 'viewer' });
    expect(dropInvites).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(['admin-1']);
  });

  it('refuses to transfer to an account without access', async () => {
    const { service } = create({ select: () => selecting([{ role: null }]) });

    await expect(
      service.transferOwnership(owner, 'orphan-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps a role that members still hold', async () => {
    const remove = jest.fn();
    const { service } = create({
      select: () => selecting([{ user_id: 'a' }, { user_id: 'b' }]),
      delete: remove,
    });

    await expect(service.removeRole('role-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses an invite that would make an owner', async () => {
    const { service } = create({});

    await expect(
      service.createInvite(owner, { role: 'owner' as 'admin', max_uses: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an admin invite from an admin', async () => {
    const { service } = create({});

    await expect(
      service.createInvite(
        { ...owner, role: 'admin' },
        { role: 'admin', max_uses: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
