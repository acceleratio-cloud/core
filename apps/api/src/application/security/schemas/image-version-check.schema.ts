import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * The newest release of the same line as an image a Docker service names,
 * looked up in its registry at most once a day. The release is scanned like
 * any image (`image_scan`, by `candidate_digest`).
 */
export const imageVersionCheck = pgTable('image_version_check', {
  // `<registry>/<repository>:<tag>`, such as `docker.io/library/nginx:1.25`.
  image: text('image').primaryKey(),
  // Null when the line has no newer release.
  candidate_tag: varchar('candidate_tag', { length: 128 }),
  candidate_digest: varchar('candidate_digest', { length: 80 }),
  // Why the registry could not be read; the next check tries again.
  error: text('error'),
  checked_at: timestamp('checked_at').defaultNow().notNull(),
});

export type ImageVersionCheckRow = typeof imageVersionCheck.$inferSelect;
