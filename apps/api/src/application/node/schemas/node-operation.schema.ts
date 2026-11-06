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

export const nodeOperationTypeEnum = pgEnum('node_operation_type', [
  'add',
  'drain',
  'remove',
]);

export const nodeOperationStatusEnum = pgEnum('node_operation_status', [
  'running',
  'succeeded',
  'failed',
]);

/**
 * One change to a cluster server: join, drain or removal. Rows are also the
 * audit trail (who started what, when, and how it ended). They never hold SSH
 * keys, passphrases or the join token; log lines are redacted before saving.
 */
export const nodeOperation = pgTable(
  'node_operation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    node_name: varchar('node_name', { length: 253 }).notNull(),
    type: nodeOperationTypeEnum('type').notNull(),
    status: nodeOperationStatusEnum('status').notNull().default('running'),
    step: varchar('step', { length: 32 }),
    message: text('message'),
    evicted: integer('evicted').notNull().default(0),
    remaining: integer('remaining').notNull().default(0),
    // Pods that did not leave the node in time, as namespace/name.
    stuck: jsonb('stuck').$type<string[]>().notNull().default([]),
    // The last lines of progress, capped by the service.
    log: jsonb('log').$type<string[]>().notNull().default([]),
    // Account email (or id) that started the operation.
    actor: varchar('actor', { length: 255 }),
    started_at: timestamp('started_at').defaultNow().notNull(),
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
    index('node_operation_node_name_idx').on(table.node_name, table.started_at),
    // One running operation per node, enforced by the database.
    uniqueIndex('node_operation_running_unique')
      .on(table.node_name)
      .where(sql`${table.status} = 'running'`),
  ],
);

export type NodeOperationRow = typeof nodeOperation.$inferSelect;
