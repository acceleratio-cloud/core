import type { WorkloadConfig, WorkloadPosition } from '@acceleratio/shared';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { project } from '../../project/schemas/project.schema';

export const workloadTypeEnum = pgEnum('workload_type', ['docker']);

export const workload = pgTable(
  'workload',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('workload_project_id_idx').on(table.projectId)],
);

export type WorkloadRow = typeof workload.$inferSelect;
export type NewWorkloadRow = typeof workload.$inferInsert;
