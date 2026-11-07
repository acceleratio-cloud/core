import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type MessageEvent,
  type OnModuleDestroy,
} from '@nestjs/common';
import { interval, map, merge, Observable, Subject, takeUntil } from 'rxjs';
import {
  LOG_LEVEL_FILTERS,
  LOG_RANGES,
  MAX_LOG_PAGE_SIZE,
  MAX_LOG_SEARCH_LENGTH,
  type LogLevelFilter,
  type LogSourceWorkload,
  type ProjectLogEntry,
  type ProjectLogHistogram,
  type ProjectLogSources,
  type ProjectLogStreamEvent,
  type ProjectLogsPage,
} from '@acceleratio/shared';
import { projectNamespace } from '@/common/naming';
import { ProjectService } from '@/application/project/project.service';
import { WorkloadService } from '@/application/workload/workload.service';
import { WORKLOAD_ID_LABEL } from '@/application/workload/docker/docker-workload.manifests';
import { HEARTBEAT_INTERVAL_MS } from '@/application/workload/observer/workload-events.service';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { isActivePod, listNamespacePods } from '@/vendor/kubernetes/pods';
import {
  parseJsonLines,
  VictoriaLogsClient,
  VictoriaLogsUnavailableError,
} from '@/vendor/victorialogs/victorialogs.client';
import {
  DEFAULT_LOG_RANGE,
  filterQuery,
  foldHistogram,
  formatCursor,
  isRfc3339,
  nextCursor,
  parseCursor,
  histogramStep,
  isLogRange,
  pageQuery,
  rangeSeconds,
  sourcesQuery,
  tailQuery,
  toLogEntry,
  type LogCursor,
  type LogFilters,
  type LogWindow,
} from './logs-query';

export const LOGS_UNAVAILABLE_MESSAGE =
  'Logs are unavailable: VictoriaLogs is not reachable in the cluster';

export const DEFAULT_LOG_PAGE_SIZE = 200;

/** Live streams one user may hold open at once (tabs, reconnects). */
export const MAX_STREAMS_PER_USER = 5;

const TOO_MANY_STREAMS_MESSAGE = `At most ${MAX_STREAMS_PER_USER} live log streams can be open at once`;

/** Most lines a live stream forwards per second; the rest are counted. */
export const MAX_STREAM_LINES_PER_SECOND = 500;

/** Longest custom window: the longest preset plus slack for zooming. */
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

/** How far back a reconnecting stream may resume. */
const MAX_RESUME_SECONDS = 60 * 60;

/** Lines a stream holds before it flushes early. */
const STREAM_BATCH_SIZE = 200;
const STREAM_FLUSH_MS = 250;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Kubernetes object name (DNS subdomain). */
const POD_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
const MAX_FILTER_VALUES = 50;

/** Query-string parameters shared by every logs endpoint. */
export interface LogsQueryInput {
  range?: unknown;
  start?: unknown;
  end?: unknown;
  workload?: unknown;
  pod?: unknown;
  level?: unknown;
  q?: unknown;
}

export interface LogsPageInput extends LogsQueryInput {
  limit?: unknown;
  cursor?: unknown;
}

export interface LogsStreamInput extends LogsQueryInput {
  since?: unknown;
}

const HEARTBEAT: MessageEvent = {
  type: 'heartbeat',
  data: { type: 'heartbeat' } satisfies ProjectLogStreamEvent,
};

/** `?a=1&a=2` and `?a=1,2` both read as `['1', '2']`. */
const listOf = (value: unknown, name: string): string[] => {
  if (value === undefined || value === '') {
    return [];
  }

  const raw = Array.isArray(value) ? value : [value];

  if (!raw.every((item) => typeof item === 'string')) {
    throw new BadRequestException(`${name} must be a string`);
  }

  const items = [
    ...new Set(
      raw
        .flatMap((item) => item.split(','))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  if (items.length > MAX_FILTER_VALUES) {
    throw new BadRequestException(
      `${name} accepts at most ${MAX_FILTER_VALUES} values`,
    );
  }

  return items;
};

const timestampOf = (value: unknown, name: string): string | null => {
  if (value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string' || !isRfc3339(value)) {
    throw new BadRequestException(`${name} must be an RFC 3339 timestamp`);
  }

  return value;
};

/**
 * Project logs from VictoriaLogs, where Vector ships every container line of
 * the project namespaces. Logs outlive pods, so history spans restarts and
 * deploys, and the live tail follows new pods without reconnecting.
 *
 * Isolation: every query starts with the project's namespace stream filter
 * (see `filterQuery`); request parameters only narrow it.
 */
@Injectable()
export class LogsService implements OnModuleDestroy {
  private readonly logger = new Logger(LogsService.name);
  private readonly streamsByUser = new Map<string, number>();
  /** Ends every live stream when the app stops (see `onModuleDestroy`). */
  private readonly shutdown$ = new Subject<void>();

  constructor(
    private readonly projectService: ProjectService,
    private readonly workloadService: WorkloadService,
    private readonly kubernetes: KubernetesService,
    private readonly victoriaLogs: VictoriaLogsClient,
  ) {}

  /**
   * Completes the open live streams at once, so log viewers see a clean end
   * and reconnect, instead of waiting for `HttpShutdownService` to cut the
   * connection after its grace period.
   */
  onModuleDestroy(): void {
    this.shutdown$.next();
    this.shutdown$.complete();
  }

  async getPage(
    projectId: string,
    input: LogsPageInput,
    now = Date.now(),
  ): Promise<ProjectLogsPage> {
    const filters = this.normalizeFilters(input);
    const window = this.normalizeWindow(input, now);
    const limit = this.normalizeLimit(input.limit);
    const cursor = this.normalizeCursor(input.cursor);

    await this.assertProject(projectId);

    const records = await this.unavailableOnError(() =>
      this.victoriaLogs.query(
        pageQuery(projectNamespace(projectId), filters, window, limit, cursor),
      ),
    );
    const entries = records.map(toLogEntry);

    return {
      entries,
      next_cursor: this.formatNextCursor(entries, limit, cursor),
      start: new Date(window.start).toISOString(),
      end: new Date(window.end).toISOString(),
    };
  }

  async getHistogram(
    projectId: string,
    input: LogsQueryInput,
    now = Date.now(),
  ): Promise<ProjectLogHistogram> {
    const filters = this.normalizeFilters(input);
    const window = this.normalizeWindow(input, now);

    await this.assertProject(projectId);

    const step = histogramStep(window);
    const start = Math.floor(window.start / 1000 / step) * step;
    const end = Math.ceil(window.end / 1000);
    const series = await this.unavailableOnError(() =>
      this.victoriaLogs.hits(
        filterQuery(projectNamespace(projectId), filters),
        start,
        end,
        step,
        'level',
      ),
    );
    const { buckets, total } = foldHistogram(series, start, end, step);

    return { start, end, step_seconds: step, buckets, total };
  }

  async getSources(
    projectId: string,
    input: LogsQueryInput,
    now = Date.now(),
  ): Promise<ProjectLogSources> {
    const window = this.normalizeWindow(input, now);

    await this.assertProject(projectId);

    const namespace = projectNamespace(projectId);
    const [workloads, pods, stats] = await Promise.all([
      this.workloadService.list(projectId),
      listNamespacePods(this.kubernetes, namespace),
      this.unavailableOnError(() =>
        this.victoriaLogs.query(sourcesQuery(namespace, window)),
      ),
    ]);

    const byId = new Map<string, LogSourceWorkload>();
    const workloadOf = (id: string): LogSourceWorkload => {
      let entry = byId.get(id);

      if (!entry) {
        entry = { workload_id: id, name: null, lines: 0, pods: [] };
        byId.set(id, entry);
      }

      return entry;
    };

    // Every Docker service is listed, even before it has written a line.
    for (const workload of workloads) {
      if (workload.type === 'docker') {
        workloadOf(workload.id).name = workload.name;
      }
    }

    for (const pod of pods) {
      const name = pod.metadata?.name;
      const workloadId = pod.metadata?.labels?.[WORKLOAD_ID_LABEL];

      if (name && workloadId && isActivePod(pod)) {
        workloadOf(workloadId).pods.push({
          name,
          live: true,
          lines: 0,
          last_seen: null,
        });
      }
    }

    for (const row of stats) {
      if (!row.workload_id || !row.pod) {
        continue;
      }

      const workload = workloadOf(row.workload_id);
      const lines = Number(row.lines) || 0;
      const existing = workload.pods.find((pod) => pod.name === row.pod);

      workload.lines += lines;

      if (existing) {
        existing.lines = lines;
        existing.last_seen = row.last_seen || null;
      } else {
        workload.pods.push({
          name: row.pod,
          live: false,
          lines,
          last_seen: row.last_seen || null,
        });
      }
    }

    const order = new Map(
      workloads.map((workload, index) => [workload.id, index]),
    );

    for (const workload of byId.values()) {
      workload.pods.sort(
        (a, b) =>
          Number(b.live) - Number(a.live) ||
          (b.last_seen ?? '').localeCompare(a.last_seen ?? '') ||
          a.name.localeCompare(b.name),
      );
    }

    return {
      workloads: [...byId.values()].sort(
        (a, b) =>
          (order.get(a.workload_id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.workload_id) ?? Number.MAX_SAFE_INTEGER) ||
          b.lines - a.lines,
      ),
    };
  }

  /**
   * Validates the request and the user's stream budget, then returns the
   * live stream. Errors here become HTTP errors before the stream opens.
   */
  async openStream(
    projectId: string,
    userId: string,
    input: LogsStreamInput,
    now = Date.now(),
  ): Promise<Observable<MessageEvent>> {
    const filters = this.normalizeFilters(input);
    const since = timestampOf(input.since, 'since');

    await this.assertProject(projectId);

    if ((this.streamsByUser.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) {
      throw new HttpException(
        TOO_MANY_STREAMS_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Resume just after the last line the client has, within an hour; a
    // fresh stream starts with the last few seconds so it is not empty.
    const resumeSeconds = since
      ? Math.min(MAX_RESUME_SECONDS, (now - Date.parse(since)) / 1000 + 5)
      : 5;
    const query = tailQuery(projectNamespace(projectId), filters, since);
    const lines = this.tail(query, resumeSeconds, userId);
    const heartbeat = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map(() => HEARTBEAT),
    );

    return merge(lines, heartbeat).pipe(takeUntil(this.shutdown$));
  }

  /**
   * Bridges `/select/logsql/tail` to batched, unnamed SSE frames. The upstream request
   * is opened on subscribe and destroyed on unsubscribe, so a closed browser
   * tab frees its connection at once.
   */
  private tail(
    query: string,
    startOffsetSeconds: number,
    userId: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let response: Awaited<ReturnType<VictoriaLogsClient['tail']>> | null =
        null;
      let closed = false;
      let partial = '';
      let batch: ProjectLogEntry[] = [];
      let dropped = 0;
      let windowStart = Date.now();
      let windowLines = 0;

      // Checked again here, where it cannot race: requests that passed the
      // early check together are admitted one subscription at a time.
      if ((this.streamsByUser.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) {
        subscriber.next({
          data: {
            type: 'error',
            message: TOO_MANY_STREAMS_MESSAGE,
          } satisfies ProjectLogStreamEvent,
        });
        subscriber.complete();
        return;
      }

      this.streamsByUser.set(userId, (this.streamsByUser.get(userId) ?? 0) + 1);

      const emit = (event: ProjectLogStreamEvent) =>
        subscriber.next({ data: event });

      const flush = () => {
        if (batch.length > 0) {
          emit({ type: 'entries', entries: batch });
          batch = [];
        }

        if (dropped > 0) {
          emit({ type: 'dropped', count: dropped });
          dropped = 0;
        }
      };

      const fail = (message: string) => {
        if (closed) {
          return;
        }

        flush();
        emit({ type: 'error', message });
        subscriber.complete();
      };

      const accept = (line: string) => {
        if (line.trim() === '') {
          return;
        }

        const now = Date.now();

        if (now - windowStart >= 1000) {
          windowStart = now;
          windowLines = 0;
        }

        if (windowLines >= MAX_STREAM_LINES_PER_SECOND) {
          dropped += 1;
          return;
        }

        try {
          const [record] = parseJsonLines(line);
          batch.push(toLogEntry(record));
          windowLines += 1;
        } catch {
          return;
        }

        if (batch.length >= STREAM_BATCH_SIZE) {
          flush();
        }
      };

      const timer = setInterval(flush, STREAM_FLUSH_MS);

      this.victoriaLogs
        .tail(query, startOffsetSeconds)
        .then((opened) => {
          if (closed) {
            opened.destroy();
            return;
          }

          response = opened;
          opened.setEncoding('utf8');
          opened.on('data', (chunk: string) => {
            const text = partial + chunk;
            const parts = text.split('\n');

            partial = parts.pop() ?? '';
            parts.forEach(accept);
          });
          opened.on('end', () => fail('The log stream ended'));
          opened.on('error', (error) => {
            this.logger.warn(`Log stream failed: ${error.message}`);
            fail('The log stream was interrupted');
          });
        })
        .catch((error: Error) => {
          this.logger.warn(`Could not open the log stream: ${error.message}`);
          fail(LOGS_UNAVAILABLE_MESSAGE);
        });

      return () => {
        closed = true;
        clearInterval(timer);
        response?.destroy();

        const count = (this.streamsByUser.get(userId) ?? 1) - 1;

        if (count > 0) {
          this.streamsByUser.set(userId, count);
        } else {
          this.streamsByUser.delete(userId);
        }
      };
    });
  }

  private normalizeCursor(value: unknown): LogCursor | null {
    if (value === undefined || value === '') {
      return null;
    }

    const cursor = typeof value === 'string' ? parseCursor(value) : null;

    if (!cursor) {
      throw new BadRequestException('cursor must be a next_cursor value');
    }

    return cursor;
  }

  private formatNextCursor(
    entries: ProjectLogEntry[],
    limit: number,
    previous: LogCursor | null,
  ): string | null {
    const cursor = nextCursor(
      entries.map((entry) => entry.time),
      limit,
      previous,
    );

    return cursor ? formatCursor(cursor) : null;
  }

  private normalizeFilters(input: LogsQueryInput): LogFilters {
    const workloadIds = listOf(input.workload, 'workload');
    const pods = listOf(input.pod, 'pod');
    const levels = listOf(input.level, 'level');

    // Isolation does not depend on these: the namespace filter already
    // limits every query to the project. Deleted services stay filterable.
    if (!workloadIds.every((id) => UUID.test(id))) {
      throw new BadRequestException('workload must be a service id');
    }

    if (!pods.every((pod) => POD_NAME.test(pod))) {
      throw new BadRequestException('pod must be a pod name');
    }

    if (
      !levels.every((level) =>
        (LOG_LEVEL_FILTERS as readonly string[]).includes(level),
      )
    ) {
      throw new BadRequestException(
        `level must be one of ${LOG_LEVEL_FILTERS.join(', ')}`,
      );
    }

    let search: string | null = null;

    if (input.q !== undefined) {
      if (typeof input.q !== 'string') {
        throw new BadRequestException('q must be a string');
      }

      search = input.q.trim() || null;

      if (search && search.length > MAX_LOG_SEARCH_LENGTH) {
        throw new BadRequestException(
          `q must be at most ${MAX_LOG_SEARCH_LENGTH} characters`,
        );
      }
    }

    return {
      workloadIds: workloadIds.map((id) => id.toLowerCase()),
      pods,
      levels: levels as LogLevelFilter[],
      search,
    };
  }

  private normalizeWindow(input: LogsQueryInput, now: number): LogWindow {
    const start = timestampOf(input.start, 'start');
    const end = timestampOf(input.end, 'end');

    if (start || end) {
      if (!start || !end) {
        throw new BadRequestException('start and end must be given together');
      }

      const window = { start: Date.parse(start), end: Date.parse(end) };

      if (window.end <= window.start) {
        throw new BadRequestException('end must be after start');
      }

      if (window.end - window.start > MAX_WINDOW_MS) {
        throw new BadRequestException('The window can be at most 31 days');
      }

      return window;
    }

    const range = input.range ?? DEFAULT_LOG_RANGE;

    if (!isLogRange(range)) {
      throw new BadRequestException(
        `range must be one of ${LOG_RANGES.join(', ')}`,
      );
    }

    return { start: now - rangeSeconds(range) * 1000, end: now };
  }

  private normalizeLimit(value: unknown): number {
    if (value === undefined || value === '') {
      return DEFAULT_LOG_PAGE_SIZE;
    }

    const limit = typeof value === 'string' ? Number(value) : NaN;

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_PAGE_SIZE) {
      throw new BadRequestException(
        `limit must be an integer from 1 to ${MAX_LOG_PAGE_SIZE}`,
      );
    }

    return limit;
  }

  private async assertProject(projectId: string): Promise<void> {
    if (!(await this.projectService.exists(projectId))) {
      throw new NotFoundException('Project not found');
    }
  }

  private async unavailableOnError<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof VictoriaLogsUnavailableError) {
        this.logger.warn(error.message);
        throw new ServiceUnavailableException(LOGS_UNAVAILABLE_MESSAGE);
      }

      throw error;
    }
  }
}
