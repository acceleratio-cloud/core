// better-auth ships ESM only; the decorators keep their metadata keys.
jest.mock('@thallesp/nestjs-better-auth', () => {
  const { SetMetadata } =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');

  return {
    AuthGuard: class AuthGuard {},
    AuthService: class AuthService {},
    AllowAnonymous: () => SetMetadata('PUBLIC', true),
    OptionalAuth: () => SetMetadata('OPTIONAL', true),
    Session: () => () => undefined,
  };
});
jest.mock('better-auth', () => ({ APIError: class APIError extends Error {} }));
jest.mock('better-auth/node', () => ({ fromNodeHeaders: () => new Headers() }));
// Only route metadata is read: ESM-only clients load as empty stand-ins.
jest.mock(
  '@kubernetes/client-node',
  () => new Proxy({}, { get: () => class {} }),
);

import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AUDIT_ACTIONS } from '@/application/audit/audit-log.interceptor';
import { ApplicationModule } from '@/application/application.module';
import { ACCESS_RULE, defaultRule, type AccessRule } from '../access';

interface Route {
  name: string;
  method: string;
  path: string;
  rule: AccessRule | 'public';
}

/** Every HTTP route with the rule AccessGuard applies to it. */
const routes = (): Route[] => {
  const controllers = Reflect.getMetadata(
    'controllers',
    ApplicationModule,
  ) as Type[];

  return controllers.flatMap((controller) => {
    const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');

    return Object.getOwnPropertyNames(controller.prototype).flatMap((key) => {
      const handler = (controller.prototype as Record<string, unknown>)[key];
      const verb = Reflect.getMetadata(METHOD_METADATA, handler as object) as
        RequestMethod | undefined;

      if (key === 'constructor' || verb === undefined) {
        return [];
      }

      const method = RequestMethod[verb];
      const path = `/${[
        prefix,
        String(Reflect.getMetadata(PATH_METADATA, handler as object) ?? ''),
      ]
        .filter((part) => part && part !== '/')
        .join('/')}`;
      const read = <T>(meta: string) =>
        (Reflect.getMetadata(meta, handler as object) ??
          Reflect.getMetadata(meta, controller)) as T | undefined;
      const rule: Route['rule'] = read<boolean>('PUBLIC')
        ? 'public'
        : (read<AccessRule>(ACCESS_RULE) ??
          defaultRule(method, path.includes(':projectId') ? 'p' : undefined));

      return [{ name: `${controller.name}.${key}`, method, path, rule }];
    });
  });
};

const levelOf = (route: Route) =>
  typeof route.rule === 'object' ? route.rule.project : null;

describe('route access', () => {
  const all = routes();
  const find = (name: string) => all.find((route) => route.name === name)!;

  it('finds the routes', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('checks a project level on every project route', () => {
    for (const route of all.filter((item) =>
      item.path.includes(':projectId'),
    )) {
      expect([route.name, levelOf(route)]).not.toEqual([route.name, null]);
    }
  });

  it('needs edit to reveal secrets or export data', () => {
    const revealing = [
      ...Object.keys(AUDIT_ACTIONS).filter(
        (name) => find(name)?.method === 'GET',
      ),
      'PostgresController.rows',
    ];

    expect(revealing.length).toBeGreaterThanOrEqual(5);

    for (const name of revealing) {
      expect([name, levelOf(find(name))]).toEqual([name, 'edit']);
    }
  });

  it('needs full access to delete a project or a service', () => {
    expect(levelOf(find('ProjectController.remove'))).toBe('delete');
    expect(levelOf(find('WorkloadController.remove'))).toBe('delete');
  });

  // A route added here is open to every custom role: add it on purpose.
  it('opens only these installation routes to custom roles', () => {
    const open = all
      .filter((route) => route.rule === 'member')
      .map((route) => `${route.method} ${route.path}`)
      .sort();

    expect(open).toEqual(
      [
        'DELETE /auth/sessions/:id',
        'DELETE /auth/sessions/others',
        'GET /auth/session',
        'GET /auth/sessions',
        'GET /integrations/github',
        'GET /integrations/github/apps/:id/branches',
        'GET /integrations/github/apps/:id/repositories',
        'GET /integrations/github/public/branches',
        'GET /integrations/github/public/repository',
        'GET /marketplace/apps',
        'GET /projects',
        'GET /storage-classes',
        'PATCH /auth/profile',
        'POST /auth/change-password',
        'POST /auth/sign-out',
        'POST /marketplace/apps/:slug/deploy',
      ].sort(),
    );
  });

  it('keeps people management to owner and admins', () => {
    for (const route of all.filter((item) =>
      /^\/(members|roles|invites)/.test(item.path),
    )) {
      const expected = route.method === 'GET' ? ['viewer'] : ['admin', 'owner'];

      expect(expected).toContain(route.rule);
    }
  });
});
