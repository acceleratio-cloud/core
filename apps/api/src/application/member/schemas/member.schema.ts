import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from '@/vendor/db/schema';
import { project } from '../../project/schemas/project.schema';

const touchedAt = () =>
  timestamp('updated_at')
    .defaultNow()
    .$onUpdate(
      () =>
        sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
    )
    .notNull();

export const memberRoleEnum = pgEnum('member_role', [
  'owner',
  'admin',
  'viewer',
  'custom',
]);

/** Ordered: `delete` includes `edit`, which includes `read`. */
export const projectAccessEnum = pgEnum('project_access', [
  'read',
  'edit',
  'delete',
]);

/** A named set of per-project grants that `custom` members hold. */
export const customRole = pgTable('custom_role', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: touchedAt(),
});

export type CustomRoleRow = typeof customRole.$inferSelect;

export const customRoleProject = pgTable(
  'custom_role_project',
  {
    role_id: uuid('role_id')
      .notNull()
      .references(() => customRole.id, { onDelete: 'cascade' }),
    project_id: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    access: projectAccessEnum('access').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.role_id, table.project_id] }),
    index('custom_role_project_project_id_idx').on(table.project_id),
  ],
);

/**
 * An account's access to the installation. An account without a row has
 * none. Exactly one owner; it changes hands only by transfer.
 */
export const member = pgTable(
  'member',
  {
    user_id: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    role_id: uuid('role_id').references(() => customRole.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: touchedAt(),
  },
  (table) => [
    uniqueIndex('member_owner_unique')
      .on(table.role)
      .where(sql`${table.role} = 'owner'`),
    index('member_role_id_idx').on(table.role_id),
    check(
      'member_custom_role_check',
      sql`(${table.role} = 'custom') = (${table.role_id} is not null)`,
    ),
  ],
);

export type MemberRow = typeof member.$inferSelect;

/**
 * An invite link. Only the SHA-256 of its token is stored. `max_uses` is 1
 * for a personal link and null for one anyone may use until it expires.
 */
export const invite = pgTable(
  'invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token_hash: text('token_hash').notNull().unique(),
    role: memberRoleEnum('role').notNull(),
    role_id: uuid('role_id').references(() => customRole.id, {
      onDelete: 'cascade',
    }),
    max_uses: integer('max_uses'),
    use_count: integer('use_count').notNull().default(0),
    expires_at: timestamp('expires_at').notNull(),
    created_by: text('created_by').references(() => user.id, {
      onDelete: 'cascade',
    }),
    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    check('invite_role_check', sql`${table.role} <> 'owner'`),
    check(
      'invite_custom_role_check',
      sql`(${table.role} = 'custom') = (${table.role_id} is not null)`,
    ),
  ],
);

export type InviteRow = typeof invite.$inferSelect;
