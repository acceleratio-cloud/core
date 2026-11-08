import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { VersionAuthorInput } from '../workload-version.service';
import { workload } from './workload.schema';

export const workloadBuildStatusEnum = pgEnum('workload_build_status', [
  'building',
  'succeeded',
  'failed',
  'cancelled',
]);

/**
 * One image build of a `github` workload. The build runs as a Job in the
 * builds namespace, named `external_name`; the API polls it and deploys the
 * pushed image when it succeeds.
 */
export const workloadBuild = pgTable(
  'workload_build',
  {
    id: uuid('id').primaryKey(),
    workload_id: uuid('workload_id')
      .notNull()
      .references(() => workload.id, { onDelete: 'cascade' }),
    commit_sha: varchar('commit_sha', { length: 64 }).notNull(),
    commit_message: text('commit_message'),
    status: workloadBuildStatusEnum('status').notNull().default('building'),
    status_message: text('status_message'),
    // Image reference by digest, as nodes pull it. Set on success.
    image: text('image'),
    // Job name in the builds namespace.
    external_name: varchar('external_name', { length: 63 }).notNull(),
    // Who deployed, recorded on the version the build deploys. Kept here so a
    // build that finishes after an API restart still credits them.
    author: jsonb('author').$type<VersionAuthorInput>(),
    // End of the builder output, kept once the build ends: the Job and its
    // pod are deleted an hour later.
    log: text('log'),
    created_at: timestamp('created_at').defaultNow().notNull(),
    finished_at: timestamp('finished_at'),
  },
  (table) => [
    index('workload_build_workload_id_created_at_idx').on(
      table.workload_id,
      table.created_at,
    ),
  ],
);

export type WorkloadBuildRow = typeof workloadBuild.$inferSelect;
