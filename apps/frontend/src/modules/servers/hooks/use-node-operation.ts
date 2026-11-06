'use client';

import { useEffect, useState } from 'react';

import type { NodeOperation } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { nodesApi } from '@/api/nodes';

const POLL_MS = 2000;

/**
 * Follows the newest operation of a node until it ends. Pass null to stop.
 * A removed node keeps its operation row, so polling works after the Node
 * object is gone.
 */
export const useNodeOperation = (
  node: string | null,
  initial: NodeOperation | null,
) => {
  const [polled, setPolled] = useState<NodeOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationId = initial?.id ?? null;

  useEffect(() => {
    if (!node || !operationId) {
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await nodesApi.operation(node);

        if (!active) {
          return;
        }

        setPolled(next);
        setError(null);

        if (next.status !== 'running') {
          return;
        }
      } catch (requestError) {
        if (!active) {
          return;
        }

        setError(getApiErrorMessage(requestError));
      }

      timer = setTimeout(poll, POLL_MS);
    };

    timer = setTimeout(poll, POLL_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [node, operationId]);

  // A poll of an older operation never replaces the one just started.
  const operation = polled?.id === operationId ? polled : initial;

  return { operation, error };
};
