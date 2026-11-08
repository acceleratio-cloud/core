import type { WorkloadConfig } from '@acceleratio/shared';
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from '@/vendor/db/schema';
import { workload } from './workload.schema';

/**
 * Immutable snapshot of a workload config that was applied to the cluster.
 * A row is written once per deploy that changed the config (or per rollback)
 * and never updated afterwards; unapplied edits live in `workload.draft_config`.
 */
export const workloadVersion = pgTable(
  'workload_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workload_id: uuid('workload_id')
      .notNull()
      .references((): AnyPgColumn => workload.id, { onDelete: 'cascade' }),
    // 1, 2, 3, … within one workload.
    number: integer('number').notNull(),
    config: jsonb('config').$type<WorkloadConfig>().notNull(),
    // The version a rollback copied its config from.
    source_version_id: uuid('source_version_id').references(
      (): AnyPgColumn => workloadVersion.id,
      { onDelete: 'set null' },
    ),
    // Who applied it. The name and email are copied at write time, so the
    // history still reads after the account is renamed or deleted.
    created_by_id: text('created_by_id').references(
      (): AnyPgColumn => user.id,
      {
        onDelete: 'set null',
      },
    ),
    created_by_name: text('created_by_name'),
    created_by_email: text('created_by_email'),
    // Set when a push to GitHub applied it: the pusher has no account here,
    // so `created_by_id` stays null and this names them on github.com.
    created_by_github_login: varchar('created_by_github_login', {
      length: 39,
    }),
    // When this version was applied to the cluster.
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('workload_version_workload_id_idx').on(table.workload_id),
    unique('workload_version_workload_id_number_unique').on(
      table.workload_id,
      table.number,
    ),
  ],
);

export type WorkloadVersionRow = typeof workloadVersion.$inferSelect;
export type NewWorkloadVersionRow = typeof workloadVersion.$inferInsert;
