import type { WorkloadConfig, WorkloadPosition } from '@acceleratio/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { project } from '../../project/schemas/project.schema';
import { storageClass } from '../../storage-class/schemas/storage-class.schema';
import { workloadVersion } from './workload-version.schema';

export const workloadTypeEnum = pgEnum('workload_type', [
  'docker',
  's3_bucket',
]);

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
    // Version applied to the cluster. Null until the first deploy.
    active_version_id: uuid('active_version_id').references(
      (): AnyPgColumn => workloadVersion.id,
      { onDelete: 'set null' },
    ),
    // Type-specific settings that are not applied yet. Null when the workload
    // has no pending changes against its active version.
    draft_config: jsonb('draft_config').$type<WorkloadConfig>(),
    // Canvas coordinates of the workload node.
    position: jsonb('position')
      .$type<WorkloadPosition>()
      .notNull()
      .default({ x: 0, y: 0 }),
    // Deployment name in the cluster. Generated once on create.
    external_name: varchar('external_name', { length: 63 }).notNull(),
    // Storage profile of an `s3_bucket` workload; null for other types. A
    // profile cannot be deleted while a bucket uses it.
    storage_class_id: uuid('storage_class_id').references(
      () => storageClass.id,
      { onDelete: 'restrict' },
    ),
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
    // SeaweedFS has one bucket namespace for the whole cluster, so a bucket
    // name is unique across projects, not only within one. Only buckets set
    // `storage_class_id`, and the predicate says so instead of naming the
    // `s3_bucket` enum value: PostgreSQL cannot use an enum value in the
    // transaction that adds it, and casting the enum to text is not
    // immutable, which an index predicate requires.
    uniqueIndex('workload_s3_bucket_name_unique')
      .on(table.external_name)
      .where(sql`${table.storage_class_id} is not null`),
  ],
);

export type WorkloadRow = typeof workload.$inferSelect;
export type NewWorkloadRow = typeof workload.$inferInsert;
