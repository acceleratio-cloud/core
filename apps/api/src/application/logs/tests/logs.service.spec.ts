import { PassThrough } from 'node:stream';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  type MessageEvent,
} from '@nestjs/common';
import { firstValueFrom, filter, take, toArray, type Subscription } from 'rxjs';
import type { Workload } from '@acceleratio/shared';
import type { ProjectService } from '@/application/project/project.service';
import type { WorkloadService } from '@/application/workload/workload.service';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  VictoriaLogsUnavailableError,
  type VictoriaLogsClient,
} from '@/vendor/victorialogs/victorialogs.client';
import {
  LOGS_UNAVAILABLE_MESSAGE,
  LogsService,
  MAX_STREAMS_PER_USER,
} from '../logs.service';

// These pull the ESM-only Kubernetes client or the database; every instance
// here is faked.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('@/application/project/project.service', () => ({
  ProjectService: class ProjectService {},
}));
jest.mock('@/application/workload/workload.service', () => ({
  WorkloadService: class WorkloadService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const namespace = `project-${projectId}`;
const apiId = '11111111-1111-4111-8111-111111111111';
const workerId = '22222222-2222-4222-8222-222222222222';
const goneId = '33333333-3333-4333-8333-333333333333';
const now = Date.parse('2026-11-07T12:00:00Z');

const record = (time: string, message = 'line') => ({
  _time: time,
  _msg: message,
  _stream_id: 's1',
  workload_id: apiId,
  pod: 'api-1',
  container: 'main',
  stream: 'stdout',
});

const build = (
  overrides: {
    exists?: boolean;
    query?: jest.Mock;
    tail?: jest.Mock;
    pods?: unknown[];
  } = {},
) => {
  const query = overrides.query ?? jest.fn().mockResolvedValue([]);
  const hits = jest.fn().mockResolvedValue([]);
  const tail = overrides.tail ?? jest.fn();
  const coreV1 = {
    listNamespacedPod: jest.fn().mockResolvedValue({
      items: overrides.pods ?? [],
    }),
  };
  const service = new LogsService(
    {
      exists: jest.fn().mockResolvedValue(overrides.exists ?? true),
    } as unknown as ProjectService,
    {
      list: jest.fn().mockResolvedValue([
        { id: apiId, name: 'api', type: 'docker' },
        { id: workerId, name: 'worker', type: 'docker' },
        { id: 'b', name: 'bucket', type: 's3_bucket' },
      ] as Workload[]),
    } as unknown as WorkloadService,
    { coreV1 } as unknown as KubernetesService,
    { query, hits, tail } as unknown as VictoriaLogsClient,
  );

  return { service, query, hits, tail, coreV1 };
};

/** Argument `index` of the first call. */
const argOf = (mock: jest.Mock, index: number): unknown =>
  (mock.mock.calls[0] as unknown[])[index];

const firstQuery = (mock: jest.Mock): string => argOf(mock, 0) as string;

describe('LogsService.getPage', () => {
  it('reads the project namespace over the preset window', async () => {
    const { service, query } = build({
      query: jest
        .fn()
        .mockResolvedValue([record('2026-11-07T11:59:00.000000002Z')]),
    });

    const page = await service.getPage(projectId, { range: '1h' }, now);

    expect(firstQuery(query)).toContain(
      `{namespace="${namespace}"} _time:[2026-11-07T11:00:00.000Z, 2026-11-07T12:00:00.000Z)`,
    );
    expect(page.entries).toHaveLength(1);
    expect(page.next_cursor).toBeNull();
    expect(page.start).toBe('2026-11-07T11:00:00.000Z');
  });

  it('returns a cursor when the page is full', async () => {
    const { service } = build({
      query: jest
        .fn()
        .mockResolvedValue([
          record('2026-11-07T11:59:02Z'),
          record('2026-11-07T11:59:01Z'),
        ]),
    });

    const page = await service.getPage(projectId, { limit: '2' }, now);

    expect(page.next_cursor).toBe('2026-11-07T11:59:01Z~1');
  });

  it('continues from a cursor without losing lines at the boundary', async () => {
    const { service, query } = build();

    await service.getPage(projectId, { cursor: '2026-11-07T11:59:01Z~2' }, now);

    expect(firstQuery(query)).toContain(
      '_time:<=2026-11-07T11:59:01Z | sort by (_time desc, _stream_id desc) offset 2 limit 200',
    );
  });

  it('passes repeated and comma-separated filters', async () => {
    const { service, query } = build();

    await service.getPage(
      projectId,
      {
        workload: [apiId, `${workerId},${apiId}`],
        pod: 'api-1',
        level: ['error', 'unknown'],
        q: '  timeout  ',
      },
      now,
    );

    expect(firstQuery(query)).toContain(
      `workload_id:in("${apiId}", "${workerId}") pod:in("api-1") (level:in("error") OR level:"") ~"(?i)timeout"`,
    );
  });

  it.each([
    [{ range: '2h' }, 'range must be one of'],
    [{ limit: '0' }, 'limit must be an integer'],
    [{ limit: '501' }, 'limit must be an integer'],
    [{ workload: 'api' }, 'workload must be a service id'],
    [{ pod: 'Api_1' }, 'pod must be a pod name'],
    [{ level: 'fatal' }, 'level must be one of'],
    [{ q: 'x'.repeat(257) }, 'q must be at most 256 characters'],
    [{ cursor: 'yesterday' }, 'cursor must be a next_cursor value'],
    [{ start: '2026-11-07T10:00:00Z' }, 'start and end must be given'],
    [
      { start: '2026-11-07T10:00:00Z', end: '2026-11-07T09:00:00Z' },
      'end must be after start',
    ],
    [
      { start: '2026-01-01T00:00:00Z', end: '2026-11-07T00:00:00Z' },
      'at most 31 days',
    ],
  ])('rejects %p', async (input, message) => {
    const { service, query } = build();

    await expect(service.getPage(projectId, input, now)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getPage(projectId, input, now)).rejects.toThrow(
      message,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('is a 404 for an unknown project', async () => {
    const { service, query } = build({ exists: false });

    await expect(service.getPage(projectId, {}, now)).rejects.toThrow(
      NotFoundException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('is a 503 when VictoriaLogs is not reachable', async () => {
    const { service } = build({
      query: jest
        .fn()
        .mockRejectedValue(new VictoriaLogsUnavailableError('refused')),
    });

    const result = service.getPage(projectId, {}, now);

    await expect(result).rejects.toThrow(ServiceUnavailableException);
    await expect(result).rejects.toThrow(LOGS_UNAVAILABLE_MESSAGE);
  });
});

describe('LogsService.getHistogram', () => {
  it('counts levels on an aligned grid for a custom window', async () => {
    const { service, hits } = build();

    hits.mockResolvedValue([
      {
        fields: { level: 'error' },
        timestamps: ['2026-11-07T11:00:00Z'],
        values: [5],
        total: 5,
      },
    ]);

    const histogram = await service.getHistogram(
      projectId,
      { start: '2026-11-07T11:00:00Z', end: '2026-11-07T12:00:00Z' },
      now,
    );

    expect(hits).toHaveBeenCalledWith(
      `{namespace="${namespace}"}`,
      histogram.start,
      histogram.end,
      60,
      'level',
    );
    expect(histogram.buckets).toHaveLength(60);
    expect(histogram.buckets[0]).toMatchObject({ error: 5 });
    expect(histogram.total).toBe(5);
  });
});

describe('LogsService.getSources', () => {
  it('merges live pods, logged pods and deleted services', async () => {
    const { service } = build({
      pods: [
        {
          metadata: {
            name: 'api-2',
            labels: { 'acceleratio.io/workload-id': apiId },
          },
          status: { phase: 'Running' },
        },
        {
          metadata: {
            name: 'api-old',
            labels: { 'acceleratio.io/workload-id': apiId },
          },
          status: { phase: 'Succeeded' },
        },
      ],
      query: jest.fn().mockResolvedValue([
        {
          workload_id: apiId,
          pod: 'api-2',
          lines: '10',
          last_seen: '2026-11-07T11:59:00Z',
        },
        {
          workload_id: apiId,
          pod: 'api-1',
          lines: '4',
          last_seen: '2026-11-07T11:00:00Z',
        },
        {
          workload_id: goneId,
          pod: 'old-1',
          lines: '2',
          last_seen: '2026-11-07T10:00:00Z',
        },
        {
          workload_id: '',
          pod: 'unlabelled',
          lines: '1',
          last_seen: '2026-11-07T10:00:00Z',
        },
      ]),
    });

    const sources = await service.getSources(projectId, {}, now);

    expect(sources.workloads).toEqual([
      {
        workload_id: apiId,
        name: 'api',
        lines: 14,
        pods: [
          {
            name: 'api-2',
            live: true,
            lines: 10,
            last_seen: '2026-11-07T11:59:00Z',
          },
          {
            name: 'api-1',
            live: false,
            lines: 4,
            last_seen: '2026-11-07T11:00:00Z',
          },
        ],
      },
      { workload_id: workerId, name: 'worker', lines: 0, pods: [] },
      {
        workload_id: goneId,
        name: null,
        lines: 2,
        pods: [
          {
            name: 'old-1',
            live: false,
            lines: 2,
            last_seen: '2026-11-07T10:00:00Z',
          },
        ],
      },
    ]);
  });

  it('treats a missing namespace as no pods', async () => {
    const { service, coreV1 } = build();

    coreV1.listNamespacedPod.mockRejectedValue({ code: 404 });

    await expect(service.getSources(projectId, {}, now)).resolves.toMatchObject(
      {
        workloads: [
          { workload_id: apiId, pods: [] },
          { workload_id: workerId, pods: [] },
        ],
      },
    );
  });
});

describe('LogsService.openStream', () => {
  const upstream = () => {
    const response = new PassThrough();
    const tail = jest.fn().mockResolvedValue(response);

    return { response, tail };
  };

  const events = (stream: Awaited<ReturnType<LogsService['openStream']>>) =>
    stream.pipe(filter((event: MessageEvent) => event.type !== 'heartbeat'));

  it('batches tail lines into entries frames', async () => {
    const { response, tail } = upstream();
    const { service } = build({ tail });
    const stream = await service.openStream(projectId, 'user-1', {}, now);
    const next = firstValueFrom(events(stream));

    await new Promise((resolve) => setImmediate(resolve));
    response.write(
      `${JSON.stringify(record('2026-11-07T12:00:01Z', 'a'))}\n${JSON.stringify(record('2026-11-07T12:00:02Z', 'b')).slice(0, 20)}`,
    );
    response.write(
      `${JSON.stringify(record('2026-11-07T12:00:02Z', 'b')).slice(20)}\n`,
    );

    const event = await next;

    expect(tail).toHaveBeenCalledWith(
      `{namespace="${namespace}"} | fields _time, _msg, _stream_id, level, stream, workload_id, pod, container`,
      5,
    );
    // Unnamed SSE frames: a named `error` event would collide with the
    // browser EventSource's own `error` event.
    expect(event.type).toBeUndefined();
    expect(event).toMatchObject({
      data: {
        type: 'entries',
        entries: [{ message: 'a' }, { message: 'b' }],
      },
    });
    response.destroy();
  });

  it('resumes after `since` and reports a closed upstream', async () => {
    const { response, tail } = upstream();
    const { service } = build({ tail });
    const stream = await service.openStream(
      projectId,
      'user-1',
      { since: '2026-11-07T11:59:00Z' },
      now,
    );
    const all = firstValueFrom(events(stream).pipe(take(1), toArray()));

    await new Promise((resolve) => setImmediate(resolve));
    response.end();

    expect(firstQuery(tail)).toContain('_time:>2026-11-07T11:59:00Z');
    expect(argOf(tail, 1)).toBe(65);
    expect(await all).toEqual([
      { data: { type: 'error', message: 'The log stream ended' } },
    ]);
  });

  it('limits open streams per user and frees them on unsubscribe', async () => {
    const { tail } = upstream();
    const { service } = build({ tail });
    const subscriptions: Subscription[] = [];

    for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) {
      const stream = await service.openStream(projectId, 'user-1', {}, now);
      subscriptions.push(stream.subscribe());
    }

    await expect(
      service.openStream(projectId, 'user-1', {}, now),
    ).rejects.toThrow(HttpException);
    await expect(
      service.openStream(projectId, 'user-2', {}, now),
    ).resolves.toBeDefined();

    subscriptions[0].unsubscribe();

    await expect(
      service.openStream(projectId, 'user-1', {}, now),
    ).resolves.toBeDefined();
    subscriptions.forEach((subscription) => subscription.unsubscribe());
  });

  it('admits concurrent opens one subscription at a time', async () => {
    const { tail } = upstream();
    const { service } = build({ tail });
    // All pass the early check before any of them subscribes.
    const streams = await Promise.all(
      Array.from({ length: MAX_STREAMS_PER_USER + 2 }, () =>
        service.openStream(projectId, 'user-1', {}, now),
      ),
    );
    const frames: unknown[][] = streams.map(() => []);
    const subscriptions = streams.map((stream, index) =>
      events(stream).subscribe((event) => frames[index].push(event)),
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(tail).toHaveBeenCalledTimes(MAX_STREAMS_PER_USER);
    expect(frames.slice(MAX_STREAMS_PER_USER)).toEqual([
      [
        {
          data: {
            type: 'error',
            message: expect.stringContaining('At most') as string,
          },
        },
      ],
      [
        {
          data: {
            type: 'error',
            message: expect.stringContaining('At most') as string,
          },
        },
      ],
    ]);
    subscriptions.forEach((subscription) => subscription.unsubscribe());
  });

  it('sends an error frame when VictoriaLogs is down', async () => {
    const tail = jest
      .fn()
      .mockRejectedValue(new VictoriaLogsUnavailableError('refused'));
    const { service } = build({ tail });
    const stream = await service.openStream(projectId, 'user-1', {}, now);

    await expect(firstValueFrom(events(stream))).resolves.toEqual({
      data: { type: 'error', message: LOGS_UNAVAILABLE_MESSAGE },
    });
  });
});

describe('LogsService shutdown', () => {
  it('completes open live streams so the HTTP server can close', async () => {
    const response = new PassThrough();
    const { service } = build({ tail: jest.fn().mockResolvedValue(response) });
    const stream = await service.openStream(projectId, 'user-1', {}, now);
    let completed = false;

    stream.subscribe({ complete: () => (completed = true) });
    await new Promise((resolve) => setImmediate(resolve));
    service.onModuleDestroy();

    expect(completed).toBe(true);
    // Completing unsubscribes the tail, which destroys the upstream request.
    expect(response.destroyed).toBe(true);
  });
});
