import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import { from, type Observable, switchMap, tap } from 'rxjs';
import { isUuid } from '@/common/validation';
import { AuditLogService } from './audit-log.service';
import { clientAddress, sanitize, userAgentOf } from './audit-log.request';

/**
 * Action names by `Controller.handler`. Mutating project routes missing here
 * are still recorded under a derived name; `null` skips a route on purpose.
 * Reads are recorded only when listed: they reveal secrets or export data.
 */
export const AUDIT_ACTIONS: Record<string, string | null> = {
  'ProjectController.create': 'project.create',
  'ProjectController.update': 'project.update',
  'ProjectController.remove': 'project.delete',
  'MarketplaceController.deploy': 'marketplace.deploy',
  'WorkloadController.create': 'service.create',
  'WorkloadController.update': 'service.update',
  'WorkloadController.remove': 'service.delete',
  'WorkloadController.deploy': 'service.deploy',
  'WorkloadController.discardDraft': 'service.draft.discard',
  'WorkloadController.start': 'service.start',
  'WorkloadController.stop': 'service.stop',
  'WorkloadController.restart': 'service.restart',
  'WorkloadController.rollback': 'service.rollback',
  'WorkloadController.cancelBuild': 'service.build.cancel',
  'WorkloadController.env': 'service.env.reveal',
  'WorkloadController.credentials': 'service.credentials.reveal',
  'WorkloadController.rotateCredentials': 'service.credentials.rotate',
  'WorkloadController.updateInternalHostname':
    'service.internal_hostname.update',
  'WorkloadController.generateDomain': 'service.domain.generate',
  'WorkloadController.addDomain': 'service.domain.add',
  'WorkloadController.updateDomain': 'service.domain.update',
  'WorkloadController.verifyDomain': 'service.domain.verify',
  'WorkloadController.removeDomain': 'service.domain.remove',
  'PostgresController.dump': 'database.dump',
  'PostgresController.import': 'database.import',
  'PostgresController.backUp': 'database.backup',
  'PostgresController.restore': 'database.restore',
  'PostgresController.updateExposure': 'database.exposure.update',
  'PostgresController.credentials': 'database.credentials.reveal',
  'PostgresController.rotateCredentials': 'database.credentials.rotate',
  'S3BucketObjectsController.createFolder': 'bucket.folder.create',
  'S3BucketObjectsController.upload': 'bucket.object.upload',
  'S3BucketObjectsController.download': 'bucket.object.download',
  'S3BucketObjectsController.remove': 'bucket.object.delete',
  'StaticReleasesController.create': 'site.release.create',
  // One request per file; the release's create and publish cover the upload.
  'StaticReleasesController.upload': null,
  'StaticReleasesController.publish': 'site.release.publish',
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WORKLOAD_ROUTE = 'projects/:projectId/workloads';
export const READ_DEDUP_MS = 10 * 60 * 1000;
const MAX_RECENT_READS = 10_000;

type AuditedRequest = Request & { session?: UserSession | null };

const actionOf = (
  controller: string,
  handler: string,
  method: string,
): string | null => {
  const key = `${controller}.${handler}`;
  if (key in AUDIT_ACTIONS) {
    return AUDIT_ACTIONS[key];
  }
  return READ_METHODS.has(method)
    ? null
    : `${controller.replace(/Controller$/, '').toLowerCase()}.${handler}`;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};

/** What the response created, so the entry links to it. */
const resultOf = (response: unknown) => {
  const body = asRecord(response);
  return Object.fromEntries(
    ['id', 'project_id', 'workload_ids'].flatMap((key) =>
      body[key] === undefined ? [] : [[key, body[key]]],
    ),
  );
};

const errorOf = (error: unknown): { status: number; message: string } => {
  if (error instanceof HttpException) {
    const response = asRecord(error.getResponse());
    const message = Array.isArray(response.message)
      ? response.message.join('; ')
      : typeof response.message === 'string'
        ? response.message
        : error.message;
    return { status: error.getStatus(), message };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : 'Unknown error',
  };
};

/**
 * Records every change made in a project, and reads that reveal secrets or
 * export data, with who, from where and how it ended. Runs after the auth
 * guard, so requests without a session never get here.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  /** Last time each actor read each secret, to keep routine views quiet. */
  private readonly recentReads = new Map<string, number>();

  constructor(private readonly audit: AuditLogService) {}

  /**
   * The console loads env and credentials whenever a panel opens; one reveal
   * per actor, action and service every READ_DEDUP_MS says the same thing.
   * shortcut: per-process memory, so each API replica records its own first read.
   */
  private isRepeatedRead(key: string, now: number): boolean {
    const last = this.recentReads.get(key);
    return last !== undefined && now - last < READ_DEDUP_MS;
  }

  /** Only a reveal that succeeded starts the quiet window. */
  private markRead(key: string, now: number): void {
    this.recentReads.set(key, now);
    if (this.recentReads.size > MAX_RECENT_READS) {
      for (const [entry, at] of this.recentReads) {
        if (now - at >= READ_DEDUP_MS) {
          this.recentReads.delete(entry);
        }
      }
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const controller = context.getClass();
    const handler = context.getHandler();
    const action = actionOf(controller.name, handler.name, request.method);
    const route = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const params = asRecord(request.params);
    const body = asRecord(request.body);
    const projectParam =
      params.projectId ??
      (route === 'projects' ? params.id : undefined) ??
      body.project_id;
    const projectId = isUuid(projectParam) ? projectParam : null;
    const workloadId =
      route.startsWith(WORKLOAD_ROUTE) && isUuid(params.id) ? params.id : null;

    // A new project or marketplace app gets its project id from the response.
    const projectFromResponse =
      controller.name === 'ProjectController' ||
      controller.name === 'MarketplaceController';
    if (!action || (!projectId && !projectFromResponse)) {
      return next.handle();
    }

    const session = request.session ?? null;
    const readKey = action.endsWith('.reveal')
      ? `${session?.user.id ?? '-'}|${action}|${workloadId ?? projectId}`
      : null;
    if (readKey && this.isRepeatedRead(readKey, Date.now())) {
      return next.handle();
    }

    const startedAt = Date.now();
    const { ip, remote } = clientAddress(request);
    const routeParams = Object.fromEntries(
      Object.entries(params).filter(([key]) => key !== 'projectId'),
    );

    const write = async (
      outcome: 'success' | 'failure',
      statusCode: number,
      error: string | null,
      nameBefore: string | null,
      response?: unknown,
    ) => {
      const durationMs = Date.now() - startedAt;
      const result = resultOf(response);
      const resolvedProject =
        projectId ??
        result.project_id ??
        (projectFromResponse ? result.id : null);
      const project = isUuid(resolvedProject) ? resolvedProject : null;
      // A failed create has no project; it is kept for a future
      // installation-wide log, every other entry belongs to one.
      if (!project && outcome === 'success') {
        return;
      }
      if (readKey && outcome === 'success') {
        this.markRead(readKey, Date.now());
      }
      const created =
        controller.name === 'WorkloadController' && handler.name === 'create'
          ? asRecord(response)
          : {};
      const targetId = workloadId ?? (isUuid(created.id) ? created.id : null);
      const workloadName =
        nameBefore ??
        (typeof created.name === 'string' ? created.name : null) ??
        (targetId && project
          ? await this.audit.workloadName(project, targetId)
          : null);

      await this.audit.record({
        project_id: project,
        action,
        outcome,
        status_code: statusCode,
        error,
        actor_type: 'user',
        actor_id: session?.user.id ?? null,
        actor_name: session?.user.name ?? null,
        actor_email: session?.user.email ?? null,
        session_id: session?.session.id ?? null,
        ip_address: ip,
        user_agent: userAgentOf(request),
        workload_id: targetId,
        workload_name: workloadName,
        http_method: request.method,
        http_path: request.originalUrl.split('?')[0],
        duration_ms: durationMs,
        metadata: {
          ...(Object.keys(routeParams).length > 0 && { params: routeParams }),
          ...(Object.keys(asRecord(request.query)).length > 0 && {
            query: sanitize(request.query),
          }),
          ...(Object.keys(body).length > 0 && { body: sanitize(body) }),
          ...(Object.keys(result).length > 0 && { result }),
          ...(remote && remote !== ip && { remote_address: remote }),
        },
      });
    };

    const successStatus =
      (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as
        number | undefined) ??
      (request.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);

    // Only a delete must read the name first: afterwards it is gone. Other
    // actions read it after the handler, off the request's path.
    const nameBefore =
      request.method === 'DELETE' && workloadId && projectId
        ? this.audit.workloadName(projectId, workloadId)
        : Promise.resolve(null);

    return from(nameBefore).pipe(
      switchMap((name) =>
        next.handle().pipe(
          tap({
            next: (response) =>
              void write('success', successStatus, null, name, response),
            error: (error: unknown) => {
              const { status, message } = errorOf(error);
              void write('failure', status, message, name);
            },
          }),
        ),
      ),
    );
  }
}
