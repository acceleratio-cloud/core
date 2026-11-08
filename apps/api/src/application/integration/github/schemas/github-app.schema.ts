import { sql } from 'drizzle-orm';
import {
  bigint,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * A GitHub App the operator created from the console. Several can exist, so
 * access can later be granted per App. The `*_enc` columns are ciphertext
 * (`common/secret-box`); the key never reaches the database.
 */
export const githubApp = pgTable('github_app', {
  // Chosen before GitHub creates the App: the webhook and setup URLs in the
  // manifest contain it.
  id: uuid('id').primaryKey(),
  github_app_id: bigint('github_app_id', { mode: 'number' }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  owner_login: varchar('owner_login', { length: 255 }).notNull(),
  html_url: text('html_url').notNull(),
  client_id: varchar('client_id', { length: 255 }).notNull(),
  client_secret_enc: text('client_secret_enc').notNull(),
  webhook_secret_enc: text('webhook_secret_enc').notNull(),
  private_key_enc: text('private_key_enc').notNull(),
  // better-auth user id; no foreign key so the auth tables stay vendor-owned.
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(
      () =>
        sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
    )
    .notNull(),
});

export type GithubAppRow = typeof githubApp.$inferSelect;
