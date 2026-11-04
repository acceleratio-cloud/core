import type { V1Job } from '@kubernetes/client-node';

export type JobOutcome = 'running' | 'succeeded' | 'failed';

/** Where a Job stands, from its counters or its terminal conditions. */
export const jobOutcome = (job: V1Job): JobOutcome => {
  const conditions = job.status?.conditions ?? [];
  const has = (type: string) =>
    conditions.some(
      (condition) => condition.type === type && condition.status === 'True',
    );

  if ((job.status?.succeeded ?? 0) > 0 || has('Complete')) {
    return 'succeeded';
  }

  if ((job.status?.failed ?? 0) > 0 || has('Failed')) {
    return 'failed';
  }

  return 'running';
};
