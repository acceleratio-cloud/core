'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

import { securityApi } from '@/api/security';
import { usePolling } from '@/modules/observability/hooks/use-polling';

/** The canvas only needs a hint; the Security tab polls on its own. */
const ATTENTION_REFRESH_MS = 60_000;

const SecurityAttentionContext = createContext<ReadonlySet<string>>(new Set());

/**
 * Which services of the project need a security fix (status `action`), for
 * a badge on their canvas card. A failed read keeps the last answer.
 */
export const SecurityAttentionProvider = ({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) => {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const security = await securityApi.get(projectId, signal);

        setIds(
          new Set(
            security.services
              .filter((item) => item.status === 'action')
              .map((item) => item.workload_id),
          ),
        );
      } catch {
        // A hint only: the Security tab shows the error.
      }
    },
    [projectId],
  );

  usePolling(load, true, ATTENTION_REFRESH_MS);

  return (
    <SecurityAttentionContext.Provider value={ids}>
      {children}
    </SecurityAttentionContext.Provider>
  );
};

export const useNeedsSecurityAction = (workloadId: string | undefined) =>
  useContext(SecurityAttentionContext).has(workloadId ?? '');
