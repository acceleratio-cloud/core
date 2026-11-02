import { Injectable } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { WorkloadStatusEvent } from '@acceleratio/shared';
import { filter, interval, map, merge, Subject } from 'rxjs';
import type { Observable } from 'rxjs';

export const HEARTBEAT_INTERVAL_MS = 20_000;

const HEARTBEAT: MessageEvent = {
  type: 'heartbeat',
  data: { type: 'heartbeat' },
};

/**
 * Fan-out for workload status changes. The controller exposes `toSse` per
 * project; the writer and the action paths publish into the same subject.
 */
@Injectable()
export class WorkloadEventsService {
  private readonly events = new Subject<WorkloadStatusEvent>();

  publish(event: WorkloadStatusEvent): void {
    this.events.next(event);
  }

  toSse(projectId: string): Observable<MessageEvent> {
    const statuses: Observable<MessageEvent> = this.events.pipe(
      filter((event) => event.project_id === projectId),
      map((event) => ({ data: event })),
    );

    // `interval` owns its timer, so unsubscribing the merged stream clears it.
    const heartbeat: Observable<MessageEvent> = interval(
      HEARTBEAT_INTERVAL_MS,
    ).pipe(map(() => HEARTBEAT));

    return merge(statuses, heartbeat);
  }
}
