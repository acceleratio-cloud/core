import { sql } from 'drizzle-orm';
import {
  check,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const controlPlaneChangeStatusEnum = pgEnum(
  'control_plane_change_status',
  ['awaiting_dns', 'provisioning', 'failed'],
);

/**
 * Installation-wide settings. A single row (id 1) is created on first write.
 * The control plane URL lives here rather than in the installer's environment
 * so a re-run of the installer does not undo a change made in the console.
 */
export const systemSetting = pgTable(
  'system_setting',
  {
    id: smallint('id').primaryKey().default(1),
    // Applied root URL (`https://host`), served by the control-plane routes.
    control_plane_url: text('control_plane_url'),
    // URL being moved to; null when no change is in progress.
    pending_control_plane_url: text('pending_control_plane_url'),
    pending_status: controlPlaneChangeStatusEnum('pending_status'),
    pending_error: text('pending_error'),
    // When `provisioning` started; bounds the wait for the certificate.
    pending_applied_at: timestamp('pending_applied_at'),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(
        () =>
          sql`greatest(now()::timestamp, updated_at + interval '1 microsecond')`,
      )
      .notNull(),
  },
  (table) => [check('system_setting_singleton', sql`${table.id} = 1`)],
);

export type SystemSettingRow = typeof systemSetting.$inferSelect;
