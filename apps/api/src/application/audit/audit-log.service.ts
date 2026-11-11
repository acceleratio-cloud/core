import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  AuditLogEntry,
  AuditLogPage,
  AuditLogWorkload,
} from '@acceleratio/shared';
import { and, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { workload } from '@/application/workload/schemas/workload.schema';
import { isUuid } from '@/common/validation';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  auditLog,
  type AuditLogRow,
  type NewAuditLogRow,
} from './schemas/audit-log.schema';

export const DEFAULT_AUDIT_PAGE_SIZE = 50;
export const MAX_AUDIT_PAGE_SIZE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;

const PRUNE_BATCH = 5000;
/** The first prune waits for startup to settle. */
const PRUNE_DELAY_MS = 5 * 60 * 1000;

/** AUDIT_RETENTION_DAYS, else a year; 0 keeps entries forever. */
export const retentionDays = (): number => {
  const raw = process.env.AUDIT_RETENTION_DAYS?.trim();
  const configured = raw ? Number(raw) : NaN;
  return Number.isInteger(configured) && configured >= 0
    ? configured
    : DEFAULT_AUDIT_RETENTION_DAYS;
};

export interface AuditLogQuery {
  before?: string;
  limit?: number;
  workloadId?: string;
}

const toEntry = (row: AuditLogRow): AuditLogEntry => ({
  ...row,
  created_at: row.created_at.toISOString(),
});

/** Writes and reads the project audit trail. */
@Injectable()
export class AuditLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditLogService.name);
  private pruneTimer?: NodeJS.Timeout;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  onModuleInit(): void {
    this.pruneTimer = setTimeout(() => {
      void this.prune();
      this.pruneTimer = setInterval(() => void this.prune(), DAY_MS);
      this.pruneTimer.unref();
    }, PRUNE_DELAY_MS);
    this.pruneTimer.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.pruneTimer);
    clearInterval(this.pruneTimer);
  }

  /**
   * Deletes entries older than the retention period in small batches, so a
   * large backlog never holds long locks on the platform database.
   */
  async prune(now = Date.now()): Promise<number> {
    const days = retentionDays();
    if (days === 0) {
      return 0;
    }
    const cutoff = new Date(now - days * DAY_MS);
    let deleted = 0;
    try {
      for (;;) {
        const batch = await this.db
          .delete(auditLog)
          .where(
            inArray(
              auditLog.id,
              this.db
                .select({ id: auditLog.id })
                .from(auditLog)
                .where(lt(auditLog.created_at, cutoff))
                .limit(PRUNE_BATCH),
            ),
          )
          .returning({ id: auditLog.id });
        deleted += batch.length;
        if (batch.length < PRUNE_BATCH) {
          return deleted;
        }
      }
    } catch (error) {
      this.logger.warn(`Could not prune the audit log: ${String(error)}`);
      return deleted;
    }
  }

  /**
   * Appends an entry. A failed write is logged and never fails the action it
   * describes.
   */
  async record(entry: NewAuditLogRow): Promise<void> {
    try {
      await this.db.insert(auditLog).values(entry);
    } catch (error) {
      this.logger.error(
        `Could not record audit entry ${entry.action} in project ${entry.project_id ?? '-'}: ${String(error)}`,
      );
    }
  }

  /** The service's current name, copied into entries so they outlive it. */
  async workloadName(
    projectId: string,
    workloadId: string,
  ): Promise<string | null> {
    try {
      const [row] = await this.db
        .select({ name: workload.name })
        .from(workload)
        .where(
          and(eq(workload.id, workloadId), eq(workload.project_id, projectId)),
        )
        .limit(1);
      return row?.name ?? null;
    } catch {
      return null;
    }
  }

  /** Every service the log names, with its latest name, for the filter. */
  async workloads(projectId: string): Promise<AuditLogWorkload[]> {
    const rows = await this.db
      .selectDistinctOn([auditLog.workload_id], {
        id: auditLog.workload_id,
        name: auditLog.workload_name,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.project_id, projectId),
          isNotNull(auditLog.workload_id),
        ),
      )
      .orderBy(auditLog.workload_id, desc(auditLog.created_at));

    return rows.flatMap((row) =>
      row.id ? [{ id: row.id, name: row.name }] : [],
    );
  }

  /** Newest first, paged by the id of the last entry already read. */
  async list(projectId: string, query: AuditLogQuery): Promise<AuditLogPage> {
    const limit = Math.min(
      Math.max(Math.trunc(query.limit ?? DEFAULT_AUDIT_PAGE_SIZE), 1),
      MAX_AUDIT_PAGE_SIZE,
    );

    if (query.before !== undefined && !isUuid(query.before)) {
      throw new BadRequestException('before must be an audit entry id');
    }
    if (query.workloadId !== undefined && !isUuid(query.workloadId)) {
      throw new BadRequestException('workload_id must be a service id');
    }

    if (query.before) {
      const [cursor] = await this.db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.id, query.before),
            eq(auditLog.project_id, projectId),
          ),
        )
        .limit(1);
      if (!cursor) {
        throw new BadRequestException(
          'before is not an entry of this project; reload the audit log',
        );
      }
    }

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.project_id, projectId),
          query.workloadId
            ? eq(auditLog.workload_id, query.workloadId)
            : undefined,
          query.before
            ? sql`(${auditLog.created_at}, ${auditLog.id}) < (select created_at, id from audit_log where id = ${query.before})`
            : undefined,
        ),
      )
      .orderBy(desc(auditLog.created_at), desc(auditLog.id))
      .limit(limit + 1);

    const entries = rows.slice(0, limit).map(toEntry);

    return {
      entries,
      next_cursor: rows.length > limit ? entries[entries.length - 1].id : null,
    };
  }
}
