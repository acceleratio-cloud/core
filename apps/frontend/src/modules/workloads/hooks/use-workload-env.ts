'use client';

import { useEffect, useState } from 'react';

import type { EnvVar } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';

type State = {
  /** Key of the request this state answers, so a stale reply is ignored. */
  key: string | null;
  env: EnvVar[] | null;
  error: string | null;
};

/**
 * Variable values of a Docker service. Workload responses carry only the
 * names, so the values come from their own request. `revision` should change
 * whenever the stored variables may have (a save, deploy or rollback); the
 * last good values stay on screen while a refetch runs.
 */
export const useWorkloadEnv = (
  projectId: string,
  workloadId: string,
  revision: string,
) => {
  const [state, setState] = useState<State>({
    key: null,
    env: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${projectId}/${workloadId}/${revision}/${attempt}`;

  useEffect(() => {
    let active = true;

    workloadsApi
      .getEnv(projectId, workloadId)
      .then(({ env }) => {
        if (active) {
          setState({ key: requestKey, env, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState((previous) => ({
            ...previous,
            key: requestKey,
            error: getApiErrorMessage(error),
          }));
        }
      });

    return () => {
      active = false;
    };
  }, [projectId, workloadId, requestKey]);

  return {
    env: state.env,
    error: state.error,
    isLoading: state.key !== requestKey,
    retry: () => setAttempt((value) => value + 1),
  };
};
