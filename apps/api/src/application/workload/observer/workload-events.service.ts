import { Injectable } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { WorkloadEvent } from '@acceleratio/shared';
import { filter, interval, map, merge, Subject } from 'rxjs';
import type { Observable } from 'rxjs';

export const HEARTBEAT_INTERVAL_MS = 20_000;

const HEARTBEAT: MessageEvent = {
  type: 'heartbeat',
  data: { type: 'heartbeat' },
};

/**
 * Fan-out for workload changes. The controller exposes `toSse` per project;
 * the status writer, the type services and the action paths publish into the
 * same subject.
 */
@Injectable()
export class WorkloadEventsService {
  private readonly events = new Subject<WorkloadEvent>();

  publish(event: WorkloadEvent): void {
    this.events.next(event);
  }

  toSse(projectId: string): Observable<MessageEvent> {
    const changes: Observable<MessageEvent> = this.events.pipe(
      filter((event) => event.project_id === projectId),
      map((event) => ({ data: event })),
    );

    // `interval` owns its timer, so unsubscribing the merged stream clears it.
    const heartbeat: Observable<MessageEvent> = interval(
      HEARTBEAT_INTERVAL_MS,
    ).pipe(map(() => HEARTBEAT));

    return merge(changes, heartbeat);
  }
}
