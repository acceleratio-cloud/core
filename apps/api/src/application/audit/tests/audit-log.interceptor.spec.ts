import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditLogInterceptor } from '../audit-log.interceptor';
import { clientAddress, REDACTED, sanitize } from '../audit-log.request';
import { retentionDays } from '../audit-log.service';
import type { AuditLogService } from '../audit-log.service';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const WORKLOAD = '22222222-2222-4222-8222-222222222222';

class WorkloadController {
  update() {}
  list() {}
  env() {}
}
Reflect.defineMetadata(
  PATH_METADATA,
  'projects/:projectId/workloads',
  WorkloadController,
);
class ProjectController {
  create() {}
}
Reflect.defineMetadata(PATH_METADATA, 'projects', ProjectController);
class StaticReleasesController {
  upload() {}
}
Reflect.defineMetadata(
  PATH_METADATA,
  'projects/:projectId/workloads/:id/releases',
  StaticReleasesController,
);

const contextFor = (
  controller: { prototype: object; name: string },
  handler: string,
  request: Record<string, unknown>,
) =>
  ({
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler],
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const request = (method: string, body: unknown = {}) => ({
  method,
  originalUrl: `/projects/${PROJECT}/workloads/${WORKLOAD}?x=1`,
  params: { projectId: PROJECT, id: WORKLOAD },
  query: {},
  body,
  headers: {
    'x-forwarded-for': '203.0.113.7, 10.42.0.5',
    'user-agent': 'Mozilla/5.0',
  },
  socket: { remoteAddress: '::ffff:10.42.0.5' },
  session: {
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
    session: { id: 's1' },
  },
});

describe('AuditLogInterceptor', () => {
  let record: jest.Mock;
  let interceptor: AuditLogInterceptor;

  beforeEach(() => {
    record = jest.fn().mockResolvedValue(undefined);
    interceptor = new AuditLogInterceptor({
      record,
      workloadName: jest.fn().mockResolvedValue('web'),
    } as unknown as AuditLogService);
  });

  it('records a change with actor, address and redacted body', async () => {
    const body = { env: [{ key: 'DB_PASSWORD', value: 's3cret' }], cpu_max: 1 };
    await lastValueFrom(
      interceptor.intercept(
        contextFor(WorkloadController, 'update', request('PATCH', body)),
        { handle: () => of({ id: WORKLOAD }) },
      ),
    );
    await new Promise(setImmediate);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT,
        action: 'service.update',
        outcome: 'success',
        status_code: 200,
        actor_id: 'u1',
        actor_email: 'ada@example.com',
        session_id: 's1',
        ip_address: '203.0.113.7',
        user_agent: 'Mozilla/5.0',
        workload_id: WORKLOAD,
        workload_name: 'web',
        http_path: `/projects/${PROJECT}/workloads/${WORKLOAD}`,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({
          params: { id: WORKLOAD },
          body: { env: [{ key: 'DB_PASSWORD', value: REDACTED }], cpu_max: 1 },
          remote_address: '10.42.0.5',
        }),
      }),
    );
  });

  it('records a failed attempt with its status and message', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor(WorkloadController, 'update', request('PATCH')),
          { handle: () => throwError(() => new NotFoundException('Gone')) },
        ),
      ),
    ).rejects.toThrow('Gone');
    await new Promise(setImmediate);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        status_code: 404,
        error: 'Gone',
      }),
    );
  });

  it('records a failed project create without a project', async () => {
    const create = { ...request('POST', { name: 'x' }), params: {} };
    await expect(
      lastValueFrom(
        interceptor.intercept(contextFor(ProjectController, 'create', create), {
          handle: () => throwError(() => new Error('db down')),
        }),
      ),
    ).rejects.toThrow('db down');
    await new Promise(setImmediate);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: null,
        action: 'project.create',
        outcome: 'failure',
        status_code: 500,
      }),
    );
  });

  it('records one reveal per actor and service while it repeats', async () => {
    const reveal = () =>
      lastValueFrom(
        interceptor.intercept(
          contextFor(WorkloadController, 'env', request('GET')),
          { handle: () => of(null) },
        ),
      );

    await reveal();
    await reveal();
    await new Promise(setImmediate);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('does not let a failed reveal hide the next successful one', async () => {
    const reveal = (fail: boolean) =>
      lastValueFrom(
        interceptor.intercept(
          contextFor(WorkloadController, 'env', request('GET')),
          {
            handle: () =>
              fail ? throwError(() => new NotFoundException('Gone')) : of(null),
          },
        ),
      ).catch(() => undefined);

    await reveal(true);
    await new Promise(setImmediate);
    await reveal(false);
    await new Promise(setImmediate);

    expect(
      record.mock.calls.map(
        ([entry]) => (entry as { outcome: string }).outcome,
      ),
    ).toEqual(['failure', 'success']);
  });

  it('records listed reads and skips other reads and per-file uploads', async () => {
    const run = (
      controller: typeof WorkloadController | typeof StaticReleasesController,
      handler: string,
      method: string,
    ) =>
      lastValueFrom(
        interceptor.intercept(
          contextFor(controller, handler, request(method)),
          {
            handle: () => of(null),
          },
        ),
      );

    await run(WorkloadController, 'list', 'GET');
    await run(StaticReleasesController, 'upload', 'PUT');
    expect(record).not.toHaveBeenCalled();

    await run(WorkloadController, 'env', 'GET');
    await new Promise(setImmediate);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'service.env.reveal' }),
    );
  });
});

describe('audit request helpers', () => {
  it('hides free-form values and passwords inside URLs', () => {
    expect(
      sanitize({
        inputs: { database_url: 'postgres://u:p@db/app', site: 'a' },
        env: [{ key: 'TOKEN', value: 'x' }],
        docker_image: 'https://bot:hunter2@registry.example/app:1',
        author: 'Ada',
      }),
    ).toEqual({
      inputs: { database_url: REDACTED, site: REDACTED },
      env: [{ key: 'TOKEN', value: REDACTED }],
      docker_image: `https://bot:${REDACTED}@registry.example/app:1`,
      author: 'Ada',
    });
  });

  it('keeps identifiers that only look secret', () => {
    expect(
      sanitize({
        secret_name: 'pg-app',
        access_key_id: 'AKIA1',
        bypass_cache: true,
        sessionAffinity: 'None',
        clientSecret: 'x',
        'x-api-key': 'y',
      }),
    ).toEqual({
      secret_name: 'pg-app',
      access_key_id: 'AKIA1',
      bypass_cache: true,
      sessionAffinity: 'None',
      clientSecret: REDACTED,
      'x-api-key': REDACTED,
    });
  });

  it('trusts X-Forwarded-For only from a private proxy', () => {
    const headers = { 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 10.42.0.9' };
    expect(
      clientAddress({
        headers,
        socket: { remoteAddress: '10.42.0.5' },
      } as never),
    ).toEqual({ ip: '203.0.113.7', remote: '10.42.0.5' });
    expect(
      clientAddress({
        headers,
        socket: { remoteAddress: '198.51.100.2' },
      } as never),
    ).toEqual({ ip: '198.51.100.2', remote: '198.51.100.2' });
  });

  it('redacts secrets at any depth and cuts long values', () => {
    expect(
      sanitize({
        name: 'web',
        inputs: { admin_password: 'x', domain: 'a.example' },
        nested: { apiKey: 'k', token: 't', list: ['a'.repeat(600)] },
      }),
    ).toEqual({
      name: 'web',
      inputs: { admin_password: REDACTED, domain: REDACTED },
      nested: {
        apiKey: REDACTED,
        token: REDACTED,
        list: [`${'a'.repeat(500)}… (600 chars)`],
      },
    });
  });

  it('prefers the first forwarded hop and falls back to the socket', () => {
    expect(
      clientAddress({
        headers: {},
        socket: { remoteAddress: '::ffff:192.0.2.1' },
      } as never),
    ).toEqual({ ip: '192.0.2.1', remote: '192.0.2.1' });
  });
});

describe('retentionDays', () => {
  afterEach(() => delete process.env.AUDIT_RETENTION_DAYS);

  it('defaults to a year when unset, empty or invalid', () => {
    for (const value of [undefined, '', ' ', 'abc', '-1', '1.5']) {
      if (value === undefined) delete process.env.AUDIT_RETENTION_DAYS;
      else process.env.AUDIT_RETENTION_DAYS = value;
      expect(retentionDays()).toBe(365);
    }
    process.env.AUDIT_RETENTION_DAYS = '0';
    expect(retentionDays()).toBe(0);
  });
});
