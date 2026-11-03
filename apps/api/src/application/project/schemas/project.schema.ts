import { sql } from 'drizzle-orm';
import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const project = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(
      () =>
        sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
    )
    .notNull(),
});

export type ProjectRow = typeof project.$inferSelect;
