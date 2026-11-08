import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { githubApp } from './github-app.schema';

export const githubInstallation = pgTable(
  'github_installation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    app_id: uuid('app_id')
      .notNull()
      .references(() => githubApp.id, { onDelete: 'cascade' }),
    installation_id: bigint('installation_id', { mode: 'number' })
      .notNull()
      .unique(),
    account_login: varchar('account_login', { length: 255 }).notNull(),
    account_type: varchar('account_type', { length: 32 }).notNull(),
    repository_selection: varchar('repository_selection', { length: 16 })
      .notNull()
      .default('all'),
    suspended: boolean('suspended').notNull().default(false),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(
        () =>
          sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
      )
      .notNull(),
  },
  (table) => [index('github_installation_app_id_idx').on(table.app_id)],
);

export type GithubInstallationRow = typeof githubInstallation.$inferSelect;
