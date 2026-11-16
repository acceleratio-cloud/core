import type { VulnerabilityCounts } from '@acceleratio/shared';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { project } from '../../project/schemas/project.schema';
import { workload } from '../../workload/schemas/workload.schema';

/**
 * A recommendation a user chose to leave alone, with why and until when. It
 * comes back when it expires or when it grows: more critical, high or
 * exploited findings than when it was accepted.
 */
export const securityAcceptance = pgTable(
  'security_acceptance',
  {
    // `<kind>:<workload id>`, as the API names the recommendation.
    recommendation_id: varchar('recommendation_id', {
      length: 120,
    }).primaryKey(),
    project_id: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    workload_id: uuid('workload_id')
      .notNull()
      .references(() => workload.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    // Name or email of who accepted it.
    accepted_by: text('accepted_by'),
    // What the recommendation closed when it was accepted.
    fixes: jsonb('fixes').$type<VulnerabilityCounts>(),
    exploited: integer('exploited').notNull().default(0),
    expires_at: timestamp('expires_at').notNull(),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('security_acceptance_project_id_idx').on(table.project_id)],
);

export type SecurityAcceptanceRow = typeof securityAcceptance.$inferSelect;

/** When the API first gave a recommendation, so a new one can say so. */
export const securityRecommendationSeen = pgTable(
  'security_recommendation_seen',
  {
    recommendation_id: varchar('recommendation_id', {
      length: 120,
    }).primaryKey(),
    project_id: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    workload_id: uuid('workload_id')
      .notNull()
      .references(() => workload.id, { onDelete: 'cascade' }),
    first_seen_at: timestamp('first_seen_at').defaultNow().notNull(),
  },
  (table) => [
    index('security_recommendation_seen_project_id_idx').on(table.project_id),
  ],
);
