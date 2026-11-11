import type { AuditActorType, AuditOutcome } from '@acceleratio/shared';
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

/**
 * Append-only record of what was done in a project. It has no foreign keys on
 * purpose: entries outlive the service, project and account they name, so
 * names are copied at write time. `project_id` is null only for a failed
 * create, which never got a project.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    created_at: timestamp('created_at').defaultNow().notNull(),
    project_id: uuid('project_id'),
    action: varchar('action', { length: 100 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).$type<AuditOutcome>().notNull(),
    status_code: integer('status_code'),
    error: text('error'),
    actor_type: varchar('actor_type', { length: 16 })
      .$type<AuditActorType>()
      .notNull(),
    actor_id: text('actor_id'),
    actor_name: text('actor_name'),
    actor_email: text('actor_email'),
    session_id: text('session_id'),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    workload_id: uuid('workload_id'),
    workload_name: text('workload_name'),
    http_method: varchar('http_method', { length: 10 }),
    http_path: text('http_path'),
    duration_ms: integer('duration_ms'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    index('audit_log_project_created_idx').on(
      table.project_id,
      table.created_at.desc(),
      table.id.desc(),
    ),
    // Retention deletes by age across projects.
    index('audit_log_created_idx').on(table.created_at),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
