// better-auth and @kubernetes/client-node ship ESM only, which Jest cannot
// load from a CommonJS test; the collaborators are stubbed instead.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  AuthService: class AuthService {},
}));

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: () => new Headers(),
}));

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

jest.mock('../../instances/workload-instances.service', () => ({
  WorkloadInstancesService: class WorkloadInstancesService {},
}));

import type { AuditLogService } from '@/application/audit/audit-log.service';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Writable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import type { AuthService } from '@thallesp/nestjs-better-auth';
import type { V1Pod } from '@kubernetes/client-node';
import { WebSocket } from 'ws';
import type {
  KubernetesService,
  PodExecRequest,
} from '@/vendor/kubernetes/kubernetes.service';
import type { WorkloadInstancesService } from '../../instances/workload-instances.service';
import { parseTerminalRequest } from '../terminal-request';
import {
  exitCodeOf,
  WorkloadTerminalService,
} from '../workload-terminal.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const WORKLOAD_ID = '22222222-2222-4222-8222-222222222222';
const POD = 'web-7d9f-abcde';
const PATH = `/projects/${PROJECT_ID}/workloads/${WORKLOAD_ID}/instances/${POD}/terminal?cols=120&rows=40`;

const runningPod = (overrides: Partial<V1Pod> = {}): V1Pod => ({
  metadata: {
    name: POD,
    labels: { 'acceleratio.io/workload-id': WORKLOAD_ID },
  },
  status: { phase: 'Running' },
  ...overrides,
});

class FakeConnection extends EventEmitter {
  close = jest.fn(() => {
    this.emit('close');
  });
}

describe('parseTerminalRequest', () => {
  it('reads the target and the initial size', () => {
    expect(parseTerminalRequest(PATH)).toEqual({
      projectId: PROJECT_ID,
      workloadId: WORKLOAD_ID,
      pod: POD,
      cols: 120,
      rows: 40,
    });
  });

  it('falls back to 80x24 for missing or absurd sizes', () => {
    const request = parseTerminalRequest(
      `/projects/${PROJECT_ID}/workloads/${WORKLOAD_ID}/instances/${POD}/terminal?cols=0&rows=99999`,
    );

    expect(request).toMatchObject({ cols: 80, rows: 24 });
  });

  it('rejects malformed ids and pod names', () => {
    expect(
      parseTerminalRequest(
        `/projects/nope/workloads/${WORKLOAD_ID}/instances/${POD}/terminal`,
      ),
    ).toBeNull();
    expect(
      parseTerminalRequest(
        `/projects/${PROJECT_ID}/workloads/${WORKLOAD_ID}/instances/Bad_Pod/terminal`,
      ),
    ).toBeNull();
    expect(parseTerminalRequest('/projects')).toBeNull();
  });
});

describe('exitCodeOf', () => {
  it('maps success to 0 and reads the ExitCode cause', () => {
    expect(exitCodeOf({ status: 'Success' })).toBe(0);
    expect(
      exitCodeOf({
        status: 'Failure',
        details: { causes: [{ reason: 'ExitCode', message: '130' }] },
      }),
    ).toBe(130);
    expect(exitCodeOf({ status: 'Failure' })).toBeNull();
  });
});

describe('WorkloadTerminalService', () => {
  let server: http.Server;
  let service: WorkloadTerminalService;
  let baseUrl: string;
  let getSession: jest.Mock;
  let assertDocker: jest.Mock;
  let readNamespacedPod: jest.Mock;
  let execInPod: jest.Mock;
  let connection: FakeConnection;
  let execRequest: PodExecRequest | undefined;
  let record: jest.Mock;

  beforeEach(async () => {
    record = jest.fn().mockResolvedValue(undefined);
    server = http.createServer();
    getSession = jest.fn().mockResolvedValue({
      user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
      session: { id: 'session-1' },
    });
    assertDocker = jest.fn().mockResolvedValue(undefined);
    readNamespacedPod = jest.fn().mockResolvedValue(runningPod());
    connection = new FakeConnection();
    execRequest = undefined;
    execInPod = jest.fn((request: PodExecRequest) => {
      execRequest = request;
      return Promise.resolve(connection);
    });

    service = new WorkloadTerminalService(
      {
        httpAdapter: { getHttpServer: () => server },
      } as unknown as HttpAdapterHost,
      { api: { getSession } } as unknown as AuthService,
      { assertDocker } as unknown as WorkloadInstancesService,
      {
        coreV1: { readNamespacedPod },
        execInPod,
      } as unknown as KubernetesService,
      {
        record,
        workloadName: jest.fn().mockResolvedValue('web'),
      } as unknown as AuditLogService,
    );
    service.onApplicationBootstrap();

    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    service.onModuleDestroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const rejectionStatus = (path: string, origin?: string) =>
    new Promise<number>((resolve, reject) => {
      const client = new WebSocket(`${baseUrl}${path}`, {
        headers: origin ? { origin } : {},
      });

      client.on('unexpected-response', (_request, response) => {
        resolve(response.statusCode ?? 0);
      });
      client.on('open', () => reject(new Error('Upgrade was accepted')));
      client.on('error', () => undefined);
    });

  const connect = () =>
    new Promise<WebSocket>((resolve, reject) => {
      const client = new WebSocket(`${baseUrl}${PATH}`, {
        headers: { origin: 'http://localhost:3000' },
      });

      client.on('open', () => resolve(client));
      client.on('error', reject);
    });

  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  it('refuses a foreign Origin', async () => {
    await expect(rejectionStatus(PATH, 'https://evil.example')).resolves.toBe(
      403,
    );
    expect(execInPod).not.toHaveBeenCalled();
    // The victim's session names them on the audit log; nothing is opened.
    await waitFor(() => record.mock.calls.length > 0);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        status_code: 403,
        actor_id: 'user-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({ origin: 'https://evil.example' }),
      }),
    );
  });

  it('refuses a request without a session', async () => {
    getSession.mockResolvedValue(null);

    await expect(rejectionStatus(PATH)).resolves.toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it('audits an opened shell and a refused one', async () => {
    const client = await connect();
    await waitFor(() => record.mock.calls.length > 0);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'service.terminal.open',
        outcome: 'success',
        status_code: 101,
        actor_id: 'user-1',
        actor_email: 'ada@example.com',
        session_id: 'session-1',
        workload_name: 'web',
        metadata: { pod: POD, origin: 'http://localhost:3000' },
      }),
    );
    client.close();

    record.mockClear();
    readNamespacedPod.mockResolvedValue(
      runningPod({ status: { phase: 'Pending' } }),
    );
    await expect(rejectionStatus(PATH)).resolves.toBe(409);
    await waitFor(() => record.mock.calls.length > 0);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        status_code: 409,
        error: 'Instance is not running',
      }),
    );
  });

  it('refuses a non-Docker workload with its HTTP status', async () => {
    assertDocker.mockRejectedValue(new BadRequestException('Not docker'));

    await expect(rejectionStatus(PATH)).resolves.toBe(400);
  });

  it('refuses a Pod of another workload', async () => {
    readNamespacedPod.mockResolvedValue(
      runningPod({
        metadata: {
          name: POD,
          labels: { 'acceleratio.io/workload-id': 'someone-else' },
        },
      }),
    );

    await expect(rejectionStatus(PATH)).resolves.toBe(404);
    expect(execInPod).not.toHaveBeenCalled();
  });

  it('refuses a Pod that is not running', async () => {
    readNamespacedPod.mockResolvedValue(
      runningPod({ status: { phase: 'Pending' } }),
    );

    await expect(rejectionStatus(PATH)).resolves.toBe(409);
  });

  it('bridges bytes and resizes to the exec stream', async () => {
    const client = await connect();
    const received: Buffer[] = [];

    client.on('message', (data: Buffer) => received.push(data));
    await waitFor(() => execRequest !== undefined);

    expect(execRequest).toMatchObject({ pod: POD, container: 'main' });

    const output = execRequest!.output as Writable & {
      columns: number;
      rows: number;
    };
    const input = execRequest!.input;

    expect(output.columns).toBe(120);
    expect(output.rows).toBe(40);

    const typed: Buffer[] = [];
    input.on('data', (chunk: Buffer) => typed.push(chunk));
    client.send(Buffer.from('ls\r'), { binary: true });
    await waitFor(() => typed.length > 0);
    expect(Buffer.concat(typed).toString()).toBe('ls\r');

    const resized = jest.fn();
    output.on('resize', resized);
    client.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
    await waitFor(() => resized.mock.calls.length > 0);
    expect([output.columns, output.rows]).toEqual([100, 30]);

    output.write(Buffer.from('file.txt\r\n'));
    await waitFor(() => received.length > 0);
    expect(received[0].toString()).toBe('file.txt\r\n');

    const closed = new Promise<number>((resolve) =>
      client.on('close', (code) => resolve(code)),
    );
    execRequest!.onStatus({ status: 'Success' });

    await expect(closed).resolves.toBe(1000);
    expect(JSON.parse(received[received.length - 1].toString())).toEqual({
      type: 'exit',
      code: 0,
      message: 'Session ended',
    });
  });

  it('closes the exec stream when the browser leaves', async () => {
    const client = await connect();

    await waitFor(() => execRequest !== undefined);
    client.close();
    await waitFor(() => connection.close.mock.calls.length > 0);

    expect(connection.close).toHaveBeenCalled();
  });
});
