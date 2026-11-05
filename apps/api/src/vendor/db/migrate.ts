import 'dotenv/config';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Applies the SQL migrations in apps/api/drizzle with the runtime drizzle-orm
 * migrator, so the production image can migrate without drizzle-kit (a dev
 * dependency). It shares drizzle-kit's journal and bookkeeping table, so
 * `bun run db:migrate` and this script can be mixed on the same database.
 *
 *   node dist/vendor/db/migrate.js
 *
 * Compiled to dist/vendor/db, three levels below apps/api; MIGRATIONS_DIR
 * overrides the folder.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const migrationsFolder =
    process.env.MIGRATIONS_DIR ?? join(__dirname, '..', '..', '..', 'drizzle');
  const pool = new Pool({ connectionString, max: 1 });

  try {
    await migrate(drizzle(pool), { migrationsFolder });
    console.log(`Applied migrations from ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
