import type { AuditLogPage, AuditLogWorkload } from '@acceleratio/shared';

import { api } from '@/api';

export type AuditLogQuery = {
  before?: string;
  workloadId?: string;
};

export const auditApi = {
  list: async (projectId: string, query: AuditLogQuery = {}) => {
    const { data } = await api.get<AuditLogPage>(
      `/projects/${encodeURIComponent(projectId)}/audit-logs`,
      {
        params: {
          before: query.before,
          workload_id: query.workloadId,
        },
      },
    );
    return data;
  },
  /** Services the log names, deleted ones included. */
  workloads: async (projectId: string) => {
    const { data } = await api.get<AuditLogWorkload[]>(
      `/projects/${encodeURIComponent(projectId)}/audit-logs/workloads`,
    );
    return data;
  },
};
