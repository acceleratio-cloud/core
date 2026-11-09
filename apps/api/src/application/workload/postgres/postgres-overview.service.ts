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
  PostgresOverview,
  PostgresRows,
  PostgresTable,
} from '@acceleratio/shared';
import { projectNamespace } from '@/common/naming';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  CNPG_CLUSTER_LABEL,
  CNPG_ROLE_LABEL,
  POSTGRES_CONTAINER,
  POSTGRES_DATABASE,
  POSTGRES_USERNAME,
} from './postgres.manifests';
import { PostgresWorkloadService } from './postgres.service';

export const ROWS_PAGE_SIZE = 50;
/** Long values are cut so one page stays small. */
export const CELL_MAX_CHARS = 1000;
const MAX_TABLES = 500;
const QUERY_TIMEOUT = '5s';
const EXEC_TIMEOUT_MS = 15_000;
const OUTPUT_MAX_BYTES = 4 * 1024 * 1024;
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

  constructor(
    private readonly databases: PostgresWorkloadService,
    private readonly kubernetes: KubernetesService,
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

  private async query<T>(
    projectId: string,
    id: string,
    sql: string,
    role?: string,
  ): Promise<T> {
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

    let output: string;

    try {
      output = await this.kubernetes.runInPod({
        namespace,
        pod: pod.metadata.name,
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
