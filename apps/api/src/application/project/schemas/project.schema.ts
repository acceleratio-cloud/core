import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const project = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type ProjectRow = typeof project.$inferSelect;
