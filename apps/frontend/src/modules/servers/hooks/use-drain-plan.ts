'use client';

import { useEffect, useState } from 'react';

import type { NodeDrainPlan } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { nodesApi } from '@/api/nodes';

/** Loads what a drain or removal would do to a node. */
export const useDrainPlan = (node: string) => {
  const [plan, setPlan] = useState<NodeDrainPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    nodesApi
      .drainPlan(node)
      .then((next) => {
        if (active) {
          setPlan(next);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(getApiErrorMessage(requestError));
        }
      });

    return () => {
      active = false;
    };
  }, [node]);

  return { plan, error };
};
