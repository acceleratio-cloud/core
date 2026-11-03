import type { WorkloadConfig, WorkloadPosition } from '@acceleratio/shared';
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { project } from '../../project/schemas/project.schema';

export const workloadTypeEnum = pgEnum('workload_type', ['docker']);

export const workloadStatusEnum = pgEnum('workload_status', [
  'draft',
  'deploying',
  'running',
  'stopped',
  'failed',
]);

export const workload = pgTable(
  'workload',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    project_id: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    type: workloadTypeEnum('type').notNull(),
    // Type-specific settings. Each workload type gets its own schema later.
    config: jsonb('config').$type<WorkloadConfig>().notNull(),
    // Canvas coordinates of the workload node.
    position: jsonb('position')
      .$type<WorkloadPosition>()
      .notNull()
      .default({ x: 0, y: 0 }),
    // Deployment name in the cluster. Generated once on create.
    external_name: varchar('external_name', { length: 63 }).notNull(),
    status: workloadStatusEnum('status').notNull().default('draft'),
    status_message: text('status_message'),
    // When the observer last derived the stored status from the cluster.
    status_observed_at: timestamp('status_observed_at'),
    last_deployed_at: timestamp('last_deployed_at'),
    created_at: timestamp('created_at').defaultNow().notNull(),
    // Use the database clock (same timezone as `defaultNow`) and never move
    // `updated_at` backwards: a JavaScript Date would be bound as UTC into a
    // `timestamp` column, and legacy rows may already hold a later wall clock.
    updated_at: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(
        () =>
          sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
      )
      .notNull(),
  },
  (table) => [
    index('workload_project_id_idx').on(table.project_id),
    unique('workload_project_id_external_name_unique').on(
      table.project_id,
      table.external_name,
    ),
  ],
);

export type WorkloadRow = typeof workload.$inferSelect;
export type NewWorkloadRow = typeof workload.$inferInsert;
