import type {
  PostgresBackups,
  PostgresCredentials,
  PostgresImportResult,
  PostgresExposure,
  PostgresOverview,
  PostgresRows,
  PostgresTable,
  RestorePostgresPayload,
  UpdatePostgresExposurePayload,
  Workload,
} from '@acceleratio/shared';

import { api, getApiBaseUrl } from '@/api';

const base = (projectId: string, id: string) =>
  `/projects/${projectId}/workloads/${id}/postgres`;

/** The Overview tab of a PostgreSQL workload; every read is read-only. */
export const postgresApi = {
  overview: async (projectId: string, id: string) => {
    const { data } = await api.get<PostgresOverview>(
      `${base(projectId, id)}/overview`,
    );
    return data;
  },
  tables: async (projectId: string, id: string) => {
    const { data } = await api.get<PostgresTable[]>(
      `${base(projectId, id)}/tables`,
    );
    return data;
  },
  rows: async (
    projectId: string,
    id: string,
    schema: string,
    table: string,
    page: number,
  ) => {
    const { data } = await api.get<PostgresRows>(
      `${base(projectId, id)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows`,
      { params: { page } },
    );
    return data;
  },
  exposure: async (projectId: string, id: string) => {
    const { data } = await api.get<PostgresExposure>(
      `${base(projectId, id)}/exposure`,
    );
    return data;
  },
  updateExposure: async (
    projectId: string,
    id: string,
    payload: UpdatePostgresExposurePayload,
  ) => {
    const { data } = await api.put<PostgresExposure>(
      `${base(projectId, id)}/exposure`,
      payload,
    );
    return data;
  },
  /** The current password, fetched only when the user asks to see it. */
  credentials: async (projectId: string, id: string) => {
    const { data } = await api.get<PostgresCredentials>(
      `${base(projectId, id)}/credentials`,
    );
    return data;
  },
  /** The new password is in this response only. */
  rotateCredentials: async (projectId: string, id: string) => {
    const { data } = await api.post<PostgresCredentials>(
      `${base(projectId, id)}/credentials/rotate`,
    );
    return data;
  },
  /** A link the browser follows, so the dump streams to disk unbuffered. */
  dumpUrl: (projectId: string, id: string) =>
    `${getApiBaseUrl()}${base(projectId, id)}/dump`,
  /** Sends the file as the raw body; the API streams it into the database. */
  importDump: async (
    projectId: string,
    id: string,
    file: File,
    onProgress?: (loaded: number) => void,
  ) => {
    const { data } = await api.post<PostgresImportResult>(
      `${base(projectId, id)}/import`,
      file,
      {
        headers: { 'Content-Type': 'application/octet-stream' },
        onUploadProgress: (event) => onProgress?.(event.loaded),
      },
    );
    return data;
  },
  backups: async (projectId: string, id: string) => {
    const { data } = await api.get<PostgresBackups>(
      `${base(projectId, id)}/backups`,
    );
    return data;
  },
  backUp: async (projectId: string, id: string) => {
    const { data } = await api.post<PostgresBackups>(
      `${base(projectId, id)}/backups`,
    );
    return data;
  },
  /** A new database with this one's data at `target_time`. */
  restore: async (
    projectId: string,
    id: string,
    payload: RestorePostgresPayload,
  ) => {
    const { data } = await api.post<Workload>(
      `${base(projectId, id)}/restore`,
      payload,
    );
    return data;
  },
};
