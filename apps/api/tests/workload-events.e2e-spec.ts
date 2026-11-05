// The workload facade pulls in the Docker type service, which loads the
// ESM-only Kubernetes client. This suite only needs the SSE route, so the
// facade is stubbed at the module boundary.
jest.mock('@/application/workload/workload.service', () => ({
  WorkloadService: class WorkloadService {},
}));

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  WorkloadEvent,
  WorkloadPositionEvent,
  WorkloadStatusEvent,
} from '@acceleratio/shared';
import { WorkloadEventsService } from '@/application/workload/observer/workload-events.service';
import { WorkloadController } from '@/application/workload/workload.controller';
import { WorkloadService } from '@/application/workload/workload.service';

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const otherProjectId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';

const requestedEvent: WorkloadStatusEvent = {
  type: 'status',
  workload_id: workloadId,
  project_id: projectId,
  status: 'running',
  status_message: null,
  status_observed_at: '2026-11-02T10:00:00.000Z',
  updated_at: '2026-11-02T10:00:01.000Z',
};

const otherProjectEvent: WorkloadStatusEvent = {
  type: 'status',
  workload_id: workloadId,
  project_id: otherProjectId,
  status: 'failed',
  status_message: 'Deployment is missing from the cluster',
  status_observed_at: '2026-11-02T10:00:00.000Z',
  updated_at: '2026-11-02T10:00:01.000Z',
};

const positionEvent: WorkloadPositionEvent = {
  type: 'position',
  workload_id: workloadId,
  project_id: projectId,
  position: { x: 640, y: 300 },
  updated_at: '2026-11-02T10:00:02.000Z',
};

/**
 * Resolves with the first workload frame of the stream. Heartbeats are skipped;
 * they only arrive after 20 s, so the suite never waits for one.
 */
const readWorkloadEvent = (
  response: http.IncomingMessage,
): Promise<WorkloadEvent> =>
  new Promise((resolve, reject) => {
    let buffer = '';

    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      buffer += chunk;

      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);

        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        if (frame.includes('event: heartbeat')) {
          continue;
        }

        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trimStart())
          .join('\n');

        if (data.length > 0) {
          resolve(JSON.parse(data) as WorkloadEvent);

          return;
        }
      }
    });
    response.on('error', reject);
    response.on('end', () => {
      reject(new Error('SSE stream ended before a workload event'));
    });
  });

describe('Workload events (e2e)', () => {
  let app: INestApplication;
  let events: WorkloadEventsService;
  let request: http.ClientRequest | undefined;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkloadController],
      providers: [
        WorkloadEventsService,
        { provide: WorkloadService, useValue: { list: jest.fn() } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    events = app.get(WorkloadEventsService);
    await app.listen(0);
  });

  afterEach(async () => {
    request?.destroy();
    request = undefined;
    await app.close();
  });

  it('streams only the events of the requested project', async () => {
    const server = app.getHttpServer() as http.Server;
    const address = server.address() as AddressInfo;
    const host = address.family === 'IPv6' ? '::1' : '127.0.0.1';

    const client = http.get({
      host,
      port: address.port,
      path: `/projects/${projectId}/workloads/events`,
      headers: { accept: 'text/event-stream' },
    });

    request = client;

    const response = await new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        client.once('response', resolve);
        client.once('error', reject);
      },
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['x-accel-buffering']).toBe('no');

    const received = readWorkloadEvent(response);

    events.publish(otherProjectEvent);

    // Gives an unfiltered event time to arrive before the requested one.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    events.publish(requestedEvent);

    await expect(received).resolves.toEqual(requestedEvent);
  }, 15_000);

  it('streams position frames', async () => {
    const server = app.getHttpServer() as http.Server;
    const address = server.address() as AddressInfo;
    const host = address.family === 'IPv6' ? '::1' : '127.0.0.1';

    const client = http.get({
      host,
      port: address.port,
      path: `/projects/${projectId}/workloads/events`,
      headers: { accept: 'text/event-stream' },
    });

    request = client;

    const response = await new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        client.once('response', resolve);
        client.once('error', reject);
      },
    );

    const received = readWorkloadEvent(response);

    events.publish(positionEvent);

    await expect(received).resolves.toEqual(positionEvent);
  }, 15_000);
});
