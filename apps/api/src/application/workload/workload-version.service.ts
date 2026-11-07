import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  WorkloadConfig,
  WorkloadDiffSide,
  WorkloadVersion,
  WorkloadVersionAuthor,
} from '@acceleratio/shared';
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { workload, type WorkloadRow } from './schemas/workload.schema';
import {
  workloadVersion,
  type WorkloadVersionRow,
} from './schemas/workload-version.schema';

export interface RecordVersionInput {
  /** Pre-generated so the manifest can carry it before the row exists. */
  id: string;
  workloadId: string;
  config: WorkloadConfig;
  sourceVersionId?: string | null;
  /** The signed-in user who asked for it; absent for platform writes. */
  author?: VersionAuthorInput | null;
  /**
   * The draft this deploy applied. The stored draft is cleared only when it
   * still equals this snapshot, so an edit made during the rollout survives.
   */
  appliedDraft?: WorkloadConfig;
}

/** The signed-in user behind a deploy or rollback. */
export interface VersionAuthorInput {
  id: string;
  name: string;
  email: string;
}

/** A side of a comparison with the config it stands for. */
export interface ResolvedDiffSide {
  side: WorkloadDiffSide;
  /** Null for `none`: a service that was never deployed. */
  config: WorkloadConfig | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Key-order independent comparison. JSONB does not keep key order, so two
 * equal configs may come back with their keys in different positions.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }

  return value;
};

export const sameConfig = (
  left: WorkloadConfig | null | undefined,
  right: WorkloadConfig | null | undefined,
): boolean =>
  JSON.stringify(canonical(left ?? null)) ===
  JSON.stringify(canonical(right ?? null));

export const toWorkloadVersion = (
  row: WorkloadVersionRow,
): WorkloadVersion => ({
  id: row.id,
  workload_id: row.workload_id,
  number: row.number,
  config: row.config,
  source_version_id: row.source_version_id,
  created_by: authorOf(row),
  created_at: row.created_at.toISOString(),
});

const authorOf = (row: WorkloadVersionRow): WorkloadVersionAuthor | null =>
  row.created_by_email === null
    ? null
    : {
        id: row.created_by_id,
        name: row.created_by_name ?? row.created_by_email,
        email: row.created_by_email,
      };

/**
 * Version history of workloads, independent of the workload type. Rows are
 * written once, after the cluster accepted the config, and never updated.
 * Callers own the workload lookup and the project scope.
 */
@Injectable()
export class WorkloadVersionService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Active versions of the given workloads, keyed by version id. */
  async findByIds(ids: string[]): Promise<Map<string, WorkloadVersionRow>> {
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select()
      .from(workloadVersion)
      .where(inArray(workloadVersion.id, ids));

    return new Map(rows.map((row) => [row.id, row]));
  }

  async list(workloadId: string): Promise<WorkloadVersionRow[]> {
    return this.db
      .select()
      .from(workloadVersion)
      .where(eq(workloadVersion.workload_id, workloadId))
      .orderBy(desc(workloadVersion.number));
  }

  async get(
    workloadId: string,
    versionId: string,
  ): Promise<WorkloadVersionRow> {
    const [row] = await this.db
      .select()
      .from(workloadVersion)
      .where(
        and(
          eq(workloadVersion.id, versionId),
          eq(workloadVersion.workload_id, workloadId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Workload version not found');
    }

    return row;
  }

  /**
   * Resolves one side of a comparison for the workload row: `active` (the
   * applied version, or `none` before the first deploy), `draft` (the pending
   * changes, or the active version when there are none) or a version id of
   * this workload.
   */
  async resolveSide(
    row: Pick<WorkloadRow, 'id' | 'active_version_id' | 'draft_config'>,
    ref: string,
  ): Promise<ResolvedDiffSide> {
    if (ref === 'draft' && row.draft_config !== null) {
      return { side: { kind: 'draft' }, config: row.draft_config };
    }

    if (ref === 'active' || ref === 'draft') {
      if (row.active_version_id === null) {
        return { side: { kind: 'none' }, config: null };
      }

      return this.sideOf(await this.get(row.id, row.active_version_id));
    }

    if (!UUID.test(ref)) {
      throw new BadRequestException(
        'A version must be "active", "draft" or a version id',
      );
    }

    return this.sideOf(await this.get(row.id, ref));
  }

  private sideOf(version: WorkloadVersionRow): ResolvedDiffSide {
    return {
      side: {
        kind: 'version',
        version_id: version.id,
        number: version.number,
      },
      config: version.config,
    };
  }

  /**
   * Stores an applied config as the next version and makes it active. The
   * workload row is locked so concurrent deploys get distinct numbers.
   */
  async record(input: RecordVersionInput): Promise<WorkloadVersionRow> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ draft_config: workload.draft_config })
        .from(workload)
        .where(eq(workload.id, input.workloadId))
        .for('update');

      if (!locked) {
        throw new NotFoundException('Workload not found');
      }

      const [{ latest }] = await tx
        .select({ latest: max(workloadVersion.number) })
        .from(workloadVersion)
        .where(eq(workloadVersion.workload_id, input.workloadId));
      const [version] = await tx
        .insert(workloadVersion)
        .values({
          id: input.id,
          workload_id: input.workloadId,
          number: (latest ?? 0) + 1,
          config: input.config,
          source_version_id: input.sourceVersionId ?? null,
          created_by_id: input.author?.id ?? null,
          created_by_name: input.author?.name ?? null,
          created_by_email: input.author?.email ?? null,
        })
        .returning();
      const clearDraft =
        input.appliedDraft !== undefined &&
        sameConfig(locked.draft_config, input.appliedDraft);

      await tx
        .update(workload)
        .set({
          active_version_id: version.id,
          ...(clearDraft ? { draft_config: null } : {}),
        })
        .where(eq(workload.id, input.workloadId));

      return version;
    });
  }

  /**
   * Clears a draft that a redeploy applied without creating a version (the
   * draft equalled the active config), keeping an edit made meanwhile.
   */
  async clearAppliedDraft(
    workloadId: string,
    appliedDraft: WorkloadConfig,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ draft_config: workload.draft_config })
        .from(workload)
        .where(eq(workload.id, workloadId))
        .for('update');

      if (locked && sameConfig(locked.draft_config, appliedDraft)) {
        await tx
          .update(workload)
          .set({ draft_config: null })
          .where(eq(workload.id, workloadId));
      }
    });
  }
}
