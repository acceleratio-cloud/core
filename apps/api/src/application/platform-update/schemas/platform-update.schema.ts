import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PlatformRelease } from '@acceleratio/shared';

export const platformUpdateStatusEnum = pgEnum('platform_update_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'rolled_back',
]);

/**
 * One platform update started from the console. Rows are also the history:
 * who updated from which version to which, and how it ended. The server
 * reports progress through a ConfigMap; the API copies it here so the status
 * survives the API being replaced by the update itself.
 */
export const platformUpdate = pgTable(
  'platform_update',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    from_version: varchar('from_version', { length: 64 }).notNull(),
    to_version: varchar('to_version', { length: 64 }).notNull(),
    status: platformUpdateStatusEnum('status').notNull().default('pending'),
    stage: varchar('stage', { length: 32 }),
    message: text('message'),
    // The tail of the update log, capped by the service.
    log: text('log').notNull().default(''),
    // Launcher Job and status ConfigMap, both named after the update.
    external_name: varchar('external_name', { length: 63 }).notNull(),
    // Account email (or id) that started the update.
    actor: varchar('actor', { length: 255 }),
    started_at: timestamp('started_at').defaultNow().notNull(),
    // Last time the server reported progress.
    reported_at: timestamp('reported_at'),
    finished_at: timestamp('finished_at'),
    updated_at: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(
        () =>
          sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
      )
      .notNull(),
  },
  (table) => [
    index('platform_update_started_at_idx').on(table.started_at),
    // One update at a time, enforced by the database.
    uniqueIndex('platform_update_active_unique')
      .on(sql`(true)`)
      .where(sql`${table.status} in ('pending', 'running')`),
  ],
);

export type PlatformUpdateRow = typeof platformUpdate.$inferSelect;

/**
 * The result of the last release check. A single row (id 1), written by the
 * periodic and the manual check, so a restart does not lose it.
 */
export const platformReleaseCheck = pgTable(
  'platform_release_check',
  {
    id: smallint('id').primaryKey().default(1),
    latest_version: varchar('latest_version', { length: 64 }),
    // Every stable release seen, newest first, with its checksums.
    releases: jsonb('releases').$type<StoredRelease[]>().notNull().default([]),
    checked_at: timestamp('checked_at'),
    error: text('error'),
    updated_at: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(
        () =>
          sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
      )
      .notNull(),
  },
  (table) => [check('platform_release_check_singleton', sql`${table.id} = 1`)],
);

/** A release as stored by the check: its public fields plus asset URLs. */
export interface StoredRelease extends PlatformRelease {
  tag: string;
  /** Download URL of SHA256SUMS. */
  checksums_url: string;
}

export type PlatformReleaseCheckRow = typeof platformReleaseCheck.$inferSelect;
