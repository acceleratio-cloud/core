import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ProjectAccessLevel } from '@acceleratio/shared';
import {
  allows,
  defaultRule,
  enforce,
  projectLevel,
  RequireAccess,
  type Access,
} from '../access';
import { AccessGuard } from '../access.guard';
import type { AccessService } from '../access.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const builtIn = (role: Access['role']): Access => ({
  userId: 'u1',
  role,
  roleId: null,
  projects: null,
});

const custom = (grants: Record<string, ProjectAccessLevel>): Access => ({
  userId: 'u1',
  role: 'custom',
  roleId: 'r1',
  projects: new Map(Object.entries(grants)),
});

describe('project levels', () => {
  it('gives owner and admin everything and read only reading', () => {
    expect(projectLevel(builtIn('owner'), A)).toBe('delete');
    expect(projectLevel(builtIn('admin'), A)).toBe('delete');
    expect(projectLevel(builtIn('viewer'), A)).toBe('read');
  });

  it('gives a custom role only its granted projects', () => {
    const dev = custom({ [A]: 'edit' });

    expect(projectLevel(dev, A)).toBe('edit');
    expect(projectLevel(dev, B)).toBeNull();
  });

  it('orders read < edit < delete', () => {
    const dev = custom({ [A]: 'edit' });

    expect(allows(dev, A, 'read')).toBe(true);
    expect(allows(dev, A, 'edit')).toBe(true);
    expect(allows(dev, A, 'delete')).toBe(false);
    expect(allows(dev, B, 'read')).toBe(false);
    expect(allows(builtIn('viewer'), A, 'edit')).toBe(false);
  });
});

describe('rules', () => {
  it('derives project levels from the method', () => {
    expect(defaultRule('GET', A)).toEqual({ project: 'read' });
    expect(defaultRule('HEAD', A)).toEqual({ project: 'read' });
    expect(defaultRule('POST', A)).toEqual({ project: 'edit' });
    expect(defaultRule('DELETE', A)).toEqual({ project: 'edit' });
  });

  it('keeps installation routes to the built-in roles', () => {
    expect(defaultRule('GET', undefined)).toBe('viewer');
    expect(defaultRule('PUT', undefined)).toBe('admin');
  });

  it('answers 404 for an unreachable project and 403 for a low level', () => {
    const dev = custom({ [A]: 'read' });

    expect(() => enforce(dev, { project: 'read' }, B)).toThrow(
      NotFoundException,
    );
    expect(() => enforce(dev, { project: 'edit' }, A)).toThrow(
      ForbiddenException,
    );
    expect(() => enforce(dev, { project: 'read' }, A)).not.toThrow();
  });

  it('denies a project rule on a route without a project', () => {
    expect(() =>
      enforce(builtIn('owner'), { project: 'read' }, undefined),
    ).toThrow(ForbiddenException);
  });

  it.each([
    ['viewer', 'owner', true],
    ['viewer', 'admin', true],
    ['viewer', 'viewer', true],
    ['viewer', 'custom', false],
    ['admin', 'owner', true],
    ['admin', 'admin', true],
    ['admin', 'viewer', false],
    ['admin', 'custom', false],
    ['owner', 'owner', true],
    ['owner', 'admin', false],
    ['member', 'custom', true],
  ] as const)('rule %s for %s: %s', (rule, role, allowed) => {
    const access = role === 'custom' ? custom({}) : builtIn(role);
    const run = () => enforce(access, rule, undefined);

    if (allowed) {
      expect(run).not.toThrow();
    } else {
      expect(run).toThrow(ForbiddenException);
    }
  });
});

describe('AccessGuard', () => {
  class Routes {
    plain() {}
    @SetMetadata('PUBLIC', true)
    open() {}
    @SetMetadata('OPTIONAL', true)
    maybe() {}
    @RequireAccess('member')
    shared() {}
  }

  const run = async (
    handler: keyof Routes,
    request: Record<string, unknown>,
    access: Access | null = builtIn('owner'),
  ) => {
    const resolve = jest.fn().mockResolvedValue(access);
    const guard = new AccessGuard(new Reflector(), {
      resolve,
    } as unknown as AccessService);
    const context = {
      getHandler: () =>
        (Routes.prototype as unknown as Record<string, unknown>)[handler],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { result: await guard.canActivate(context), resolve };
  };

  const signedIn = { user: { id: 'u1' }, session: { id: 's1' } };

  it('fails closed when the session was never read', async () => {
    await expect(run('plain', { method: 'GET' })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('lets public routes and anonymous optional routes through', async () => {
    await expect(run('open', { method: 'POST' })).resolves.toMatchObject({
      result: true,
    });
    await expect(
      run('maybe', { method: 'GET', session: null }),
    ).resolves.toMatchObject({ result: true });
  });

  it('signs out an account without access on an optional route', async () => {
    const request: Record<string, unknown> = {
      method: 'GET',
      session: signedIn,
    };

    await run('maybe', request, null);

    expect(request.session).toBeNull();
  });

  it('refuses an account without access everywhere else', async () => {
    await expect(
      run('plain', { method: 'GET', session: signedIn }, null),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('checks the project in the path', async () => {
    const request = {
      method: 'POST',
      session: signedIn,
      params: { projectId: A },
    };

    await expect(
      run('plain', request, custom({ [A]: 'read' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      run('plain', { ...request, params: { projectId: B } }, custom({})),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      run('plain', request, custom({ [A]: 'edit' })),
    ).resolves.toMatchObject({ result: true });
  });

  it('keeps read only and custom roles off installation changes', async () => {
    const request = { method: 'POST', session: signedIn };

    await expect(
      run('plain', request, builtIn('viewer')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      run('plain', { ...request, method: 'GET' }, custom({})),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      run('shared', { ...request, method: 'GET' }, custom({})),
    ).resolves.toMatchObject({ result: true });
  });

  it('exposes the access to the handler', async () => {
    const request: Record<string, unknown> = {
      method: 'GET',
      session: signedIn,
    };
    const access = builtIn('admin');

    await run('plain', request, access);

    expect(request.access).toBe(access);
  });
});
