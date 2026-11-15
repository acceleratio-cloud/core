'use client';

import { useCallback, useState } from 'react';

import type { ServiceTrafficEdge } from '@acceleratio/shared';
import { isApiRequestCancelled } from '@/api';
import { metricsApi } from '@/api/metrics';
import { usePolling } from '@/modules/observability/hooks/use-polling';

const noEdges: ServiceTrafficEdge[] = [];

/**
 * Links between the project's services, refreshed with the metrics while
 * the page is visible. Traffic is decoration on the canvas: when it cannot
 * be read (no metrics, an error) the links go away rather than show old
 * traffic as live.
 */
export const useProjectTraffic = (projectId: string) => {
  const [edges, setEdges] = useState(noEdges);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const traffic = await metricsApi.traffic(projectId, signal);

        if (!signal.aborted) {
          setEdges(traffic.edges);
        }
      } catch (error) {
        if (!signal.aborted && !isApiRequestCancelled(error)) {
          setEdges(noEdges);
        }
      }
    },
    [projectId],
  );

  usePolling(load);

  return edges;
};
