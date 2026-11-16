import type { Vulnerability, VulnerabilityCounts } from '@acceleratio/shared';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const imageScanStatusEnum = pgEnum('image_scan_status', [
  'pending',
  'scanning',
  'succeeded',
  'failed',
]);

/**
 * The latest vulnerability scan of one image, keyed by digest: services in
 * any project that run the same image share it. The scan runs as a Trivy Job
 * named `external_name` in the scan namespace.
 */
export const imageScan = pgTable(
  'image_scan',
  {
    id: uuid('id').primaryKey(),
    // `sha256:…`.
    digest: varchar('digest', { length: 80 }).notNull(),
    // `<repository>@<digest>` as a node pulled it; the scanner pulls the same.
    image: text('image').notNull(),
    status: imageScanStatusEnum('status').notNull().default('pending'),
    status_message: text('status_message'),
    counts: jsonb('counts').$type<VulnerabilityCounts>(),
    fixable: integer('fixable'),
    // Highest severity first, capped at MAX_LISTED_VULNERABILITIES.
    vulnerabilities: jsonb('vulnerabilities').$type<Vulnerability[]>(),
    external_name: varchar('external_name', { length: 63 }),
    // Queue order of a pending scan.
    requested_at: timestamp('requested_at').defaultNow().notNull(),
    started_at: timestamp('started_at'),
    finished_at: timestamp('finished_at'),
    // Last time a pod was seen running the image; unused scans are pruned.
    last_seen_at: timestamp('last_seen_at').defaultNow().notNull(),
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
    uniqueIndex('image_scan_digest_unique').on(table.digest),
    index('image_scan_status_idx').on(table.status, table.requested_at),
    // One scan at a time across the cluster: it pulls whole images.
    uniqueIndex('image_scan_active_unique')
      .on(sql`(true)`)
      .where(sql`${table.status} = 'scanning'`),
  ],
);

export type ImageScanRow = typeof imageScan.$inferSelect;
