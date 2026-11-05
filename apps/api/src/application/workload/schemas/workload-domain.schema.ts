import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { workload } from './workload.schema';

export const workloadDomainKindEnum = pgEnum('workload_domain_kind', [
  'generated',
  'custom',
]);

export const workloadDomainStatusEnum = pgEnum('workload_domain_status', [
  'generated',
  'verification',
  'success',
  'failed',
]);

/**
 * `pending`: no trusted certificate is served yet (or the domain is not
 * routed). `issued`: the hostname completed a trusted TLS handshake.
 * `failed`: none was issued within the timeout.
 */
export const workloadDomainCertificateStatusEnum = pgEnum(
  'workload_domain_certificate_status',
  ['pending', 'issued', 'failed'],
);

/**
 * Hostnames that send HTTPS traffic to a Docker service. They live outside
 * the versioned config: adding, changing or removing one writes Traefik routes
 * and the service's Kubernetes Service right away and never rolls pods.
 */
export const workloadDomain = pgTable(
  'workload_domain',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workload_id: uuid('workload_id')
      .notNull()
      .references(() => workload.id, { onDelete: 'cascade' }),
    // Lowercase, without a trailing dot. Unique cluster-wide: Traefik matches
    // routes by host across every namespace.
    hostname: varchar('hostname', { length: 253 }).notNull(),
    kind: workloadDomainKindEnum('kind').notNull(),
    // Container port the domain targets.
    port: integer('port').notNull(),
    status: workloadDomainStatusEnum('status').notNull(),
    status_message: text('status_message'),
    // True while the domain has IngressRoutes. A custom domain gets them only
    // once its A record points to the server.
    routed: boolean('routed').notNull().default(false),
    // When the routes were published (a custom domain's A record verified,
    // or a generated domain was created); bounds the wait for the certificate.
    verified_at: timestamp('verified_at'),
    certificate_status: workloadDomainCertificateStatusEnum(
      'certificate_status',
    )
      .notNull()
      .default('pending'),
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
    index('workload_domain_workload_id_idx').on(table.workload_id),
    unique('workload_domain_hostname_unique').on(table.hostname),
    // One generated domain per service.
    uniqueIndex('workload_domain_generated_unique')
      .on(table.workload_id)
      .where(sql`${table.kind} = 'generated'`),
    check('workload_domain_port_range', sql`${table.port} between 1 and 65535`),
  ],
);

export type WorkloadDomainRow = typeof workloadDomain.$inferSelect;
export type NewWorkloadDomainRow = typeof workloadDomain.$inferInsert;
