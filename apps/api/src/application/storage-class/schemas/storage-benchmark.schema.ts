import type { StorageBenchmarkResults } from '@acceleratio/shared';
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { storageClass } from './storage-class.schema';

export const storageBenchmarkStatusEnum = pgEnum('storage_benchmark_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
]);

/**
 * One fio run against a temporary volume of a storage class. Rows are the
 * benchmark history and outlive their profile; the Job and volume in the
 * cluster are removed after the run.
 */
export const storageBenchmark = pgTable(
  'storage_benchmark',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null once the profile is deleted; the run stays in the history.
    storage_class_id: uuid('storage_class_id').references(
      () => storageClass.id,
      { onDelete: 'set null' },
    ),
    // Profile name when the run started, shown after the profile is gone.
    storage_class_name: varchar('storage_class_name', {
      length: 255,
    }).notNull(),
    status: storageBenchmarkStatusEnum('status').notNull().default('pending'),
    status_message: text('status_message'),
    results: jsonb('results').$type<StorageBenchmarkResults>(),
    // Job and PVC name in the benchmark namespace.
    external_name: varchar('external_name', { length: 63 }).notNull(),
    started_at: timestamp('started_at'),
    finished_at: timestamp('finished_at'),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(
        () =>
          sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
      )
      .notNull(),
  },
  (table) => [
    index('storage_benchmark_storage_class_id_idx').on(
      table.storage_class_id,
      table.created_at,
    ),
    // One benchmark at a time across the cluster: it loads shared storage.
    uniqueIndex('storage_benchmark_active_unique')
      .on(sql`(true)`)
      .where(sql`${table.status} in ('pending', 'running')`),
  ],
);

export type StorageBenchmarkRow = typeof storageBenchmark.$inferSelect;
