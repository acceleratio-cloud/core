import type { StorageClassParameters } from '@acceleratio/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const storageClassKindEnum = pgEnum('storage_class_kind', [
  'platform',
  'custom',
]);

export const storageClassReclaimPolicyEnum = pgEnum(
  'storage_class_reclaim_policy',
  ['Delete', 'Retain'],
);

export const storageClassVolumeBindingModeEnum = pgEnum(
  'storage_class_volume_binding_mode',
  ['Immediate', 'WaitForFirstConsumer'],
);

/**
 * Longhorn-backed Kubernetes StorageClasses. The row is the stable identity
 * that other resources reference (`storage_class_id ... on delete restrict`)
 * and the desired state of a custom class. The platform row only anchors the
 * installer's class: its settings are read from the cluster, so the settings
 * columns stay null for it.
 */
export const storageClass = pgTable(
  'storage_class',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: storageClassKindEnum('kind').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    // StorageClass name in the cluster. Generated once on create.
    external_name: varchar('external_name', { length: 63 }).notNull(),
    // Immutable after create: Kubernetes forbids changing them in place.
    parameters: jsonb('parameters').$type<StorageClassParameters>(),
    reclaim_policy: storageClassReclaimPolicyEnum('reclaim_policy'),
    volume_binding_mode: storageClassVolumeBindingModeEnum(
      'volume_binding_mode',
    ),
    allow_volume_expansion: boolean('allow_volume_expansion')
      .notNull()
      .default(false),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(
        () =>
          sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
      )
      .notNull(),
  },
  (table) => [
    uniqueIndex('storage_class_external_name_unique').on(table.external_name),
    // At most one platform row.
    uniqueIndex('storage_class_platform_unique')
      .on(table.kind)
      .where(sql`${table.kind} = 'platform'`),
  ],
);

export type StorageClassRow = typeof storageClass.$inferSelect;
export type NewStorageClassRow = typeof storageClass.$inferInsert;
