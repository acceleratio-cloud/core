import { PROJECT_TAB_PARAM } from '@/modules/projects/tabs';
import { LOGS_POD_PARAM, LOGS_SERVICE_PARAM } from './constants';

/**
 * The project page on the Logs tab, filtered to a service or one of its pods.
 * The tab reads these parameters whenever they change, so a link works from
 * any tab of the same project.
 */
export const projectLogsHref = (
  projectId: string,
  target: { service?: string; pod?: string } = {},
) => {
  const params = new URLSearchParams({ [PROJECT_TAB_PARAM]: 'logs' });

  setLogsTargetParams(params, target);

  return `/project/${projectId}?${params.toString()}`;
};

/** Writes (or clears) the service and pod a Logs link is filtered to. */
export const setLogsTargetParams = (
  params: URLSearchParams,
  target: { service?: string; pod?: string },
) => {
  for (const [key, value] of [
    [LOGS_SERVICE_PARAM, target.service],
    [LOGS_POD_PARAM, target.pod],
  ] as const) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }
};
