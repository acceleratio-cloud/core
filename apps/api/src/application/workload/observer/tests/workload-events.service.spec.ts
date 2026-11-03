import type { MessageEvent } from '@nestjs/common';
import type {
  WorkloadPositionEvent,
  WorkloadStatusEvent,
} from '@acceleratio/shared';
import {
  HEARTBEAT_INTERVAL_MS,
  WorkloadEventsService,
} from '../workload-events.service';

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const otherProjectId = '8e4b2c1d-3a5f-4b6e-9c7d-0e1f2a3b4c5d';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';

const createEvent = (
  overrides: Partial<WorkloadStatusEvent> = {},
): WorkloadStatusEvent => ({
  type: 'status',
  workload_id: workloadId,
  project_id: projectId,
  status: 'running',
  status_message: null,
  status_observed_at: '2026-11-02T10:00:00.000Z',
  updated_at: '2026-11-02T10:00:01.000Z',
  ...overrides,
});

const createPositionEvent = (
  overrides: Partial<WorkloadPositionEvent> = {},
): WorkloadPositionEvent => ({
  type: 'position',
  workload_id: workloadId,
  project_id: projectId,
  position: { x: 320, y: 120 },
  updated_at: '2026-11-02T10:00:02.000Z',
  ...overrides,
});

const collect = (service: WorkloadEventsService, id = projectId) => {
  const received: MessageEvent[] = [];
  const subscription = service.toSse(id).subscribe((event) => {
    received.push(event);
  });

  return { received, subscription };
};

describe('WorkloadEventsService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes status events as the default SSE message', () => {
    const service = new WorkloadEventsService();
    const { received, subscription } = collect(service);
    const event = createEvent();

    service.publish(event);

    expect(received).toEqual([{ data: event }]);
    subscription.unsubscribe();
  });

  it('publishes position events as the default SSE message', () => {
    const service = new WorkloadEventsService();
    const { received, subscription } = collect(service);
    const event = createPositionEvent();

    service.publish(event);

    expect(received).toEqual([{ data: event }]);
    subscription.unsubscribe();
  });

  it('filters events by project', () => {
    const service = new WorkloadEventsService();
    const { received, subscription } = collect(service);

    service.publish(createEvent({ project_id: otherProjectId }));
    service.publish(createEvent({ workload_id: 'mine' }));

    expect(received).toHaveLength(1);
    expect(received[0].data).toMatchObject({
      project_id: projectId,
      workload_id: 'mine',
    });
    subscription.unsubscribe();
  });

  it('emits a heartbeat every twenty seconds', () => {
    const service = new WorkloadEventsService();
    const { received, subscription } = collect(service);

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    expect(received).toEqual([
      { type: 'heartbeat', data: { type: 'heartbeat' } },
    ]);
    subscription.unsubscribe();
  });

  it('does not emit a heartbeat before the interval', () => {
    const service = new WorkloadEventsService();
    const { received, subscription } = collect(service);

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);

    expect(received).toHaveLength(0);
    subscription.unsubscribe();
  });

  it('stops the heartbeat after unsubscribe', () => {
    const service = new WorkloadEventsService();
    const { received, subscription } = collect(service);

    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    subscription.unsubscribe();
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

    expect(received).toHaveLength(1);
  });

  it('serves each project its own event stream', () => {
    const service = new WorkloadEventsService();
    const mine = collect(service);
    const other = collect(service, otherProjectId);

    service.publish(createEvent({ workload_id: 'mine' }));
    service.publish(
      createEvent({ project_id: otherProjectId, workload_id: 'theirs' }),
    );

    expect(mine.received.map((event) => event.data)).toEqual([
      createEvent({ workload_id: 'mine' }),
    ]);
    expect(other.received.map((event) => event.data)).toEqual([
      createEvent({ project_id: otherProjectId, workload_id: 'theirs' }),
    ]);
    mine.subscription.unsubscribe();
    other.subscription.unsubscribe();
  });
});
