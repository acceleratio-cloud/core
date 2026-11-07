'use client';

import { useEffect, useState } from 'react';

import type { WorkloadVersionDiff } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';

export type VersionDiffState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; diff: WorkloadVersionDiff };

/**
 * What to compare: two sides (`active`, `draft` or a version id), or what a
 * rollback to a version would apply. Null loads nothing.
 */
export type VersionDiffRequest =
  | { kind: 'compare'; base: string; target: string }
  | { kind: 'rollback'; versionId: string }
  | null;

const requestKey = (request: VersionDiffRequest) =>
  request === null
    ? null
    : request.kind === 'compare'
      ? `compare:${request.base}:${request.target}`
      : `rollback:${request.versionId}`;

/**
 * Loads one comparison from the API, which computes it so every workload
 * type answers in the same shape. `revision` reloads it, for example when the
 * draft or the active version moved underneath.
 */
export const useVersionDiff = (
  projectId: string,
  workloadId: string,
  request: VersionDiffRequest,
  revision?: string | null,
): VersionDiffState => {
  const key = requestKey(request);
  const [state, setState] = useState<{
    key: string | null;
    value: VersionDiffState;
  }>({ key: null, value: { status: 'loading' } });

  useEffect(() => {
    if (request === null) {
      return;
    }

    const controller = new AbortController();
    const load =
      request.kind === 'compare'
        ? workloadsApi.diffVersions(
            projectId,
            workloadId,
            { base: request.base, target: request.target },
            controller.signal,
          )
        : workloadsApi.previewRollback(
            projectId,
            workloadId,
            request.versionId,
            controller.signal,
          );

    load
      .then((diff) => {
        if (!controller.signal.aborted) {
          setState({ key, value: { status: 'ready', diff } });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            key,
            value: { status: 'error', message: getApiErrorMessage(error) },
          });
        }
      });

    return () => controller.abort();
    // `request` is identified by its key; a new object with the same key is
    // the same comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workloadId, key, revision]);

  // A different comparison shows loading until its own answer arrives.
  return state.key === key ? state.value : { status: 'loading' };
};
