import { PassThrough, type Readable } from 'node:stream';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  PostgresImportResult,
  PostgresOverview,
  PostgresRows,
  PostgresTable,
} from '@acceleratio/shared';
import { projectNamespace } from '@/common/naming';
import {
  COMMAND_TIMED_OUT,
  KubernetesService,
} from '@/vendor/kubernetes/kubernetes.service';
import {
  CNPG_CLUSTER_LABEL,
  CNPG_ROLE_LABEL,
  POSTGRES_CONTAINER,
  POSTGRES_DATABASE,
  POSTGRES_USERNAME,
} from './postgres.manifests';
import { PostgresAccessService } from './postgres-access.service';
import { PostgresWorkloadService } from './postgres.service';

export const ROWS_PAGE_SIZE = 50;
/** Long values are cut so one page stays small. */
export const CELL_MAX_CHARS = 1000;
const MAX_TABLES = 500;
const QUERY_TIMEOUT = '5s';
const EXEC_TIMEOUT_MS = 15_000;
const OUTPUT_MAX_BYTES = 4 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 60 * 60 * 1000;
/** The first bytes of a pg_dump custom-format archive. */
const DUMP_MAGIC = 'PGDMP';

export const isCustomDump = (head: Buffer): boolean =>
  head.toString('latin1') === DUMP_MAGIC;

/**
 * Reads the password from the first line of stdin, so it never appears in a
 * command line, then runs the command with the rest of stdin.
 */
const WITH_PASSWORD =
  'IFS= read -r PGPASSWORD && export PGPASSWORD && exec "$@"';
export const INTERRUPTED_MESSAGE =
  'The upload was interrupted, so nothing was imported';
/** Errors of a dump that sets owners or privileges of other roles. */
const FOREIGN_ROLE_ERROR =
  /role ".*" does not exist|must be (able to SET ROLE|member of role)|permission denied to (grant|change owner)/;
export const FOREIGN_ROLE_HINT =
  'The dump sets owners or privileges of other roles, which the app user cannot. Make it with pg_dump --no-owner --no-acl, or in the custom format (-Fc), which is imported without them.';

/** The error to show for a failed import, with a way out when there is one. */
export const importFailure = (message: string): string =>
  `The dump was not imported, and the database is unchanged: ${message}`.slice(
    0,
    2000,
  ) + (FOREIGN_ROLE_ERROR.test(message) ? ` ${FOREIGN_ROLE_HINT}` : '');

export const UNKNOWN_OUTCOME_MESSAGE =
  'The import did not finish within an hour and may still complete or roll back. Check the data before importing again.';

/**
 * Connects as `app` with its password over TCP, never as the superuser, so
 * a dump cannot step outside what `app` may do and everything it creates
 * belongs to `app`. The archive runs in one transaction that stops at the
 * first error; a SQL script gets its transaction from importInput.
 */
export const importCommand = (format: 'custom' | 'sql'): string[] => [
  'sh',
  '-c',
  WITH_PASSWORD,
  'import',
  ...(format === 'custom'
    ? [
        'pg_restore',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        '--single-transaction',
        '--exit-on-error',
      ]
    : ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-o', '/dev/null']),
  '-h',
  '127.0.0.1',
  '-U',
  POSTGRES_USERNAME,
  '-d',
  POSTGRES_DATABASE,
];

/**
 * What the import command reads: the password line, then the dump. A SQL
 * script is wrapped in BEGIN and a COMMIT that is only sent once the whole
 * upload arrived, so a cut-off upload ends without a COMMIT and rolls back;
 * an archive cut short fails pg_restore. Either way stdin is closed at once,
 * so the command never waits on an upload that will not come.
 */
export const importInput = (
  body: Readable,
  format: 'custom' | 'sql',
  password: string,
): { stream: Readable; interrupted: () => boolean } => {
  const stream = new PassThrough();
  let interrupted = false;
  const abort = () => {
    if (!body.readableEnded && !stream.writableEnded) {
      interrupted = true;
      body.unpipe(stream);
      stream.end();
    }
  };

  stream.write(`${password}\n`);

  if (format === 'sql') {
    stream.write('BEGIN;\n');
  }

  body.pipe(stream, { end: false });
  body.once('end', () => {
    stream.end(format === 'sql' ? '\n;\nCOMMIT;\n' : undefined);
  });
  body.once('close', abort);
  body.once('error', abort);

  return { stream, interrupted: () => interrupted };
};

/** The first `size` bytes of a stream, put back so the stream still starts there. */
export const peek = (stream: Readable, size: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const read = () => {
      // Null until `size` bytes arrived, unless the stream ended shorter.
      const head = stream.read(size) as Buffer | null;

      if (head === null && !stream.readableEnded) {
        return;
      }

      stream.off('readable', read);
      stream.off('end', read);
      stream.off('error', reject);

      if (head) {
        stream.unshift(head);
      }

      resolve(head ?? Buffer.alloc(0));
    };

    stream.on('readable', read);
    stream.on('end', read);
    stream.on('error', reject);
  });
const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema')`;
const USER_RELATION = `n.nspname not in ${SYSTEM_SCHEMAS} and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'`;

/** `"name"`: the only quoting PostgreSQL identifiers need. */
export const quoteIdent = (value: string): string =>
  `"${value.replace(/"/g, '""')}"`;

/** `'value'` with `standard_conforming_strings` on, the default since 9.1. */
export const quoteLiteral = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;

export const OVERVIEW_SQL = `
select json_build_object(
  'version', current_setting('server_version'),
  'started_at', pg_postmaster_start_time(),
  'database_size_bytes', pg_database_size(current_database()),
  'connections', (
    select json_build_object(
      'active', count(*) filter (where state = 'active'),
      'idle', count(*) filter (where state like 'idle%'),
      'max', current_setting('max_connections')::int)
    from pg_stat_activity
    where backend_type = 'client backend' and pid <> pg_backend_pid()),
  'transactions_per_second', (
    select round(((xact_commit + xact_rollback) / greatest(extract(epoch from now() - coalesce(stats_reset, pg_postmaster_start_time())), 1))::numeric, 2)
    from pg_stat_database where datname = current_database()),
  'cache_hit_ratio', (
    select round((blks_hit::numeric / nullif(blks_hit + blks_read, 0)), 4)
    from pg_stat_database where datname = current_database()),
  'waiting_locks', (select count(*) from pg_locks where not granted),
  'long_queries', (
    select coalesce(json_agg(json_build_object(
      'pid', pid, 'state', state,
      'duration_seconds', round(extract(epoch from now() - query_start)::numeric, 1),
      'query', left(query, 500)) order by query_start), '[]')
    from pg_stat_activity
    where state = 'active' and backend_type = 'client backend'
      and pid <> pg_backend_pid() and now() - query_start > interval '30 seconds')
)`;

export const TABLES_SQL = `
select coalesce(json_agg(t order by t.schema, t.name), '[]') from (
  select n.nspname as schema, c.relname as name,
    pg_total_relation_size(c.oid) as size_bytes,
    c.reltuples::bigint as row_estimate,
    (select coalesce(json_agg(json_build_object(
        'name', i.relname, 'definition', pg_get_indexdef(i.oid),
        'size_bytes', pg_relation_size(i.oid)) order by i.relname), '[]')
      from pg_index x join pg_class i on i.oid = x.indexrelid
      where x.indrelid = c.oid) as indexes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and ${USER_RELATION}
  order by n.nspname, c.relname
  limit ${MAX_TABLES}
) t`;

/** Whether `schema.table` is a user table or view, never a system catalog. */
export const tableExistsSql = (schema: string, table: string): string => `
select to_json(exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = ${quoteLiteral(schema)} and c.relname = ${quoteLiteral(table)}
    and c.relkind in ('r', 'p', 'v', 'm') and ${USER_RELATION}))`;

/**
 * One page plus one row, to know whether more follow. Values keep the
 * column order through `json_each` and print as PostgreSQL text.
 */
export const rowsSql = (
  schema: string,
  table: string,
  page: number,
): string => {
  const relation = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  return `
select json_build_object(
  'columns', (
    select coalesce(json_agg(attname order by attnum), '[]')
    from pg_attribute
    where attrelid = ${quoteLiteral(relation)}::regclass and attnum > 0 and not attisdropped),
  'rows', (
    select coalesce(json_agg(array(
      select left(v.value #>> '{}', ${CELL_MAX_CHARS})
      from json_each(row_to_json(t)) with ordinality as v(key, value, n)
      order by v.n)), '[]')
    from (select * from ${relation} limit ${ROWS_PAGE_SIZE + 1} offset ${page * ROWS_PAGE_SIZE}) t)
)`;
};

/**
 * Reads a database's state, structure and rows by running `psql` in its
 * primary pod over the local socket, so the API needs no network path or
 * password. Every statement runs in a read-only session with a timeout;
 * only fixed queries run, and user-supplied names are quoted and checked
 * against the catalog first.
 */
@Injectable()
export class PostgresOverviewService {
  private readonly logger = new Logger(PostgresOverviewService.name);

  /** Databases an import is running into, one at a time each. */
  private readonly importing = new Set<string>();

  constructor(
    private readonly databases: PostgresWorkloadService,
    private readonly kubernetes: KubernetesService,
    private readonly access: PostgresAccessService,
  ) {}

  async overview(projectId: string, id: string): Promise<PostgresOverview> {
    return this.query<PostgresOverview>(projectId, id, OVERVIEW_SQL);
  }

  async tables(projectId: string, id: string): Promise<PostgresTable[]> {
    return this.query<PostgresTable[]>(projectId, id, TABLES_SQL);
  }

  async rows(
    projectId: string,
    id: string,
    schema: string,
    table: string,
    pageInput: unknown,
  ): Promise<PostgresRows> {
    const page = pageInput === undefined ? 0 : Number(pageInput);

    if (!Number.isInteger(page) || page < 0 || page > 100_000) {
      throw new BadRequestException('page must be a whole number from 0');
    }

    if (!schema || !table || schema.length > 63 || table.length > 63) {
      throw new BadRequestException('Unknown table');
    }

    const exists = await this.query<boolean>(
      projectId,
      id,
      tableExistsSql(schema, table),
    );

    if (!exists) {
      throw new NotFoundException('Table not found');
    }

    const result = await this.query<{
      columns: string[];
      rows: (string | null)[][];
      // Rows of a view run its functions with the reader's rights, so they
      // are read as the database owner, never as the superuser.
    }>(projectId, id, rowsSql(schema, table, page), POSTGRES_USERNAME);

    return {
      columns: result.columns,
      rows: result.rows.slice(0, ROWS_PAGE_SIZE),
      page,
      page_size: ROWS_PAGE_SIZE,
      has_more: result.rows.length > ROWS_PAGE_SIZE,
    };
  }

  /**
   * The `app` database as a `pg_dump` custom-format archive, streamed from
   * the primary. A dump that fails part way breaks the download instead of
   * ending it, so a cut-off file is never saved as complete.
   */
  async dump(
    projectId: string,
    id: string,
  ): Promise<{ name: string; body: Readable }> {
    const { row, namespace, pod } = await this.primaryPod(projectId, id);
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

    return {
      name: `${row.external_name}-${stamp}.dump`,
      body: this.kubernetes.streamFromPod({
        namespace,
        pod,
        container: POSTGRES_CONTAINER,
        command: ['pg_dump', '-Fc', '-d', POSTGRES_DATABASE],
      }),
    };
  }

  /**
   * Loads a dump into the `app` database as the `app` user, all or nothing:
   * a custom-format archive through pg_restore, replacing the objects it
   * holds, anything else as SQL through psql. The body streams to the
   * command's stdin. shortcut: exec stdin ignores backpressure, so the whole
   * upload may sit in memory at once; stream it with flow control before
   * allowing dumps much larger than the API's memory.
   */
  async import(
    projectId: string,
    id: string,
    body: Readable,
  ): Promise<PostgresImportResult> {
    const { row, namespace, pod } = await this.primaryPod(projectId, id);

    if (this.importing.has(row.id)) {
      throw new ConflictException('An import into this database is running');
    }

    this.importing.add(row.id);

    try {
      const { password } = await this.access.credentials(projectId, id);
      const format = isCustomDump(await peek(body, DUMP_MAGIC.length))
        ? 'custom'
        : 'sql';
      const input = importInput(body, format, password);

      try {
        await this.kubernetes.runInPod({
          namespace,
          pod,
          container: POSTGRES_CONTAINER,
          command: importCommand(format),
          stdin: input.stream,
          timeoutMs: IMPORT_TIMEOUT_MS,
          maxBytes: OUTPUT_MAX_BYTES,
        });
      } catch (error) {
        if (input.interrupted()) {
          throw new BadRequestException(INTERRUPTED_MESSAGE);
        }

        const message = error instanceof Error ? error.message : String(error);

        if (message === COMMAND_TIMED_OUT) {
          throw new ServiceUnavailableException(UNKNOWN_OUTCOME_MESSAGE);
        }

        throw new BadRequestException(importFailure(message));
      }

      // psql exits cleanly at the end of a cut-off script; it rolled back.
      if (input.interrupted()) {
        throw new BadRequestException(INTERRUPTED_MESSAGE);
      }

      return { format };
    } finally {
      this.importing.delete(row.id);
    }
  }

  private async primaryPod(projectId: string, id: string) {
    const row = await this.databases.findDatabase(projectId, id);
    const namespace = projectNamespace(row.project_id);
    const { items } = await this.kubernetes.coreV1.listNamespacedPod({
      namespace,
      labelSelector: `${CNPG_CLUSTER_LABEL}=${row.external_name},${CNPG_ROLE_LABEL}=primary`,
    });
    const pod = items.find((item) => item.status?.phase === 'Running');

    if (!pod?.metadata?.name) {
      throw new ConflictException('The database is not running');
    }

    return { row, namespace, pod: pod.metadata.name };
  }

  private async query<T>(
    projectId: string,
    id: string,
    sql: string,
    role?: string,
  ): Promise<T> {
    const { row, namespace, pod } = await this.primaryPod(projectId, id);

    let output: string;

    try {
      output = await this.kubernetes.runInPod({
        namespace,
        pod,
        container: POSTGRES_CONTAINER,
        // Session settings travel in PGOPTIONS, so the only statement is
        // the query and stdout holds just its JSON value.
        command: [
          'env',
          `PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=${QUERY_TIMEOUT}${role ? ` -c role=${role}` : ''}`,
          'psql',
          '-X',
          '-A',
          '-t',
          '-v',
          'ON_ERROR_STOP=1',
          '-d',
          POSTGRES_DATABASE,
          '-c',
          sql,
        ],
        timeoutMs: EXEC_TIMEOUT_MS,
        maxBytes: OUTPUT_MAX_BYTES,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Query on database ${row.external_name} failed: ${message}`,
      );

      if (/permission denied/.test(message)) {
        throw new ForbiddenException(
          `The ${POSTGRES_USERNAME} user cannot read this table`,
        );
      }

      throw new ServiceUnavailableException(
        /statement timeout/.test(message)
          ? 'The query took too long'
          : 'Could not read the database',
      );
    }

    try {
      return JSON.parse(output.trim()) as T;
    } catch {
      this.logger.warn(
        `Database ${row.external_name} returned output that is not JSON`,
      );

      throw new ServiceUnavailableException('Could not read the database');
    }
  }
}
