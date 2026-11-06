import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  NodeOperation,
  NodeOperationStatus,
  NodeOperationType,
} from '@acceleratio/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { nodeOperation } from './schemas/node-operation.schema';
import type { NodeOperationRow } from './schemas/node-operation.schema';

const UNIQUE_VIOLATION = '23505';
const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_LENGTH = 500;

export interface NodeOperationPatch {
  status?: NodeOperationStatus;
  step?: string | null;
  message?: string | null;
  evicted?: number;
  remaining?: number;
  stuck?: string[];
}

/** Persistence of node operations: progress for the console and the audit trail. */
export interface NodeOperationRepository {
  start(
    node: string,
    type: NodeOperationType,
    actor: string | null,
    remaining?: number,
  ): Promise<NodeOperation>;
  update(id: string, patch: NodeOperationPatch): Promise<void>;
  log(id: string, line: string): Promise<void>;
  current(node: string): Promise<NodeOperation>;
  history(node: string, limit?: number): Promise<NodeOperation[]>;
  failInterrupted(): Promise<void>;
}

const isUniqueViolation = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; cause?: unknown } | undefined;

  return (
    candidate?.code === UNIQUE_VIOLATION ||
    (candidate?.cause !== undefined && isUniqueViolation(candidate.cause))
  );
};

export const toNodeOperation = (row: NodeOperationRow): NodeOperation => ({
  id: row.id,
  node: row.node_name,
  type: row.type,
  status: row.status,
  remaining: row.remaining,
  evicted: row.evicted,
  stuck: row.stuck,
  message: row.message,
  step: row.step,
  log: row.log,
  actor: row.actor,
  started_at: row.started_at.toISOString(),
  finished_at: row.finished_at?.toISOString() ?? null,
});

@Injectable()
export class NodeOperationStore
  implements NodeOperationRepository, OnModuleInit
{
  /** Pending log appends per operation, so lines land in call order. */
  private readonly logQueues = new Map<string, Promise<void>>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    await this.failInterrupted();
  }

  async start(
    node: string,
    type: NodeOperationType,
    actor: string | null,
    remaining = 0,
  ): Promise<NodeOperation> {
    try {
      const [row] = await this.db
        .insert(nodeOperation)
        .values({ node_name: node, type, actor, remaining })
        .returning();

      return toNodeOperation(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Another operation is running on this node',
        );
      }

      throw error;
    }
  }

  async update(id: string, patch: NodeOperationPatch): Promise<void> {
    const finished = patch.status !== undefined && patch.status !== 'running';

    await this.db
      .update(nodeOperation)
      .set({
        ...patch,
        ...(finished ? { finished_at: new Date() } : {}),
      })
      .where(eq(nodeOperation.id, id));
  }

  /**
   * Appends a line. Callers fire these without waiting (one per line of
   * command output), so appends are chained per operation to keep their
   * order, and each one is a single UPDATE that cannot lose a concurrent line.
   */
  log(id: string, line: string): Promise<void> {
    const next = (this.logQueues.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.appendLog(id, line));

    this.logQueues.set(id, next);
    next
      .finally(() => {
        if (this.logQueues.get(id) === next) {
          this.logQueues.delete(id);
        }
      })
      .catch(() => undefined);

    return next;
  }

  private async appendLog(id: string, line: string): Promise<void> {
    const entry = line.slice(0, MAX_LOG_LINE_LENGTH);

    // Keeps the newest MAX_LOG_LINES lines, oldest first.
    await this.db
      .update(nodeOperation)
      .set({
        log: sql`(
          select coalesce(jsonb_agg(kept.value order by kept.idx), '[]'::jsonb)
          from (
            select item.value, item.idx
            from jsonb_array_elements(
              ${nodeOperation.log} || jsonb_build_array(${entry}::text)
            ) with ordinality as item(value, idx)
            order by item.idx desc
            limit ${MAX_LOG_LINES}
          ) as kept
        )`,
      })
      .where(eq(nodeOperation.id, id));
  }

  async current(node: string): Promise<NodeOperation> {
    const [row] = await this.db
      .select()
      .from(nodeOperation)
      .where(eq(nodeOperation.node_name, node))
      .orderBy(desc(nodeOperation.started_at))
      .limit(1);

    if (!row) {
      throw new NotFoundException('No operation for this node');
    }

    return toNodeOperation(row);
  }

  async history(node: string, limit = 20): Promise<NodeOperation[]> {
    const rows = await this.db
      .select()
      .from(nodeOperation)
      .where(eq(nodeOperation.node_name, node))
      .orderBy(desc(nodeOperation.started_at))
      .limit(limit);

    return rows.map(toNodeOperation);
  }

  /**
   * Operations run inside the API process, so one still marked running when
   * the API starts was cut off by a restart and cannot continue.
   */
  async failInterrupted(): Promise<void> {
    await this.db
      .update(nodeOperation)
      .set({
        status: 'failed',
        message: 'Interrupted by an API restart; check the node state',
        finished_at: new Date(),
      })
      .where(eq(nodeOperation.status, 'running'));
  }
}
