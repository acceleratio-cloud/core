'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { WorkloadDomain, WorkloadDomains } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadDomainsApi } from '@/api/workloads/domains';
import { hasPendingDomains } from '@/modules/workloads/utils/workload-domains';

/** How often the list is re-read while a custom domain is in verification. */
export const DOMAINS_POLL_MS = 5000;

type State = {
  data: WorkloadDomains | null;
  error: string | null;
  loading: boolean;
};

type Entry = {
  key: string;
  state: State;
  listeners: Set<() => void>;
  /** Bumped by every read and mutation, so a stale answer is dropped. */
  request: number;
  timer: number | undefined;
};

const INITIAL: State = { data: null, error: null, loading: true };

/**
 * One entry per service, shared by every view that shows its domains (the
 * canvas card and the details panel), so they read once, poll once, and a
 * change made in one shows in the other at once.
 */
const entries = new Map<string, Entry>();

const keyOf = (projectId: string, workloadId: string) =>
  `${projectId}/${workloadId}`;

const entryFor = (key: string): Entry => {
  let entry = entries.get(key);

  if (!entry) {
    entry = {
      key,
      state: INITIAL,
      listeners: new Set(),
      request: 0,
      timer: undefined,
    };
    entries.set(key, entry);
  }

  return entry;
};

const setState = (entry: Entry, next: (previous: State) => State) => {
  entry.state = next(entry.state);
  entry.listeners.forEach((listener) => listener());
  syncPolling(entry);
};

/** Polls while anything waits for DNS or a certificate and someone watches. */
function syncPolling(entry: Entry) {
  const shouldPoll =
    entry.listeners.size > 0 &&
    entry.state.data !== null &&
    hasPendingDomains(entry.state.data.domains);

  if (shouldPoll && entry.timer === undefined) {
    entry.timer = window.setInterval(
      () => void refreshEntry(entry.key),
      DOMAINS_POLL_MS,
    );
  } else if (!shouldPoll && entry.timer !== undefined) {
    window.clearInterval(entry.timer);
    entry.timer = undefined;
  }
}

async function refreshEntry(key: string) {
  const [projectId, workloadId] = key.split('/');
  const entry = entryFor(key);
  const request = ++entry.request;

  try {
    const data = await workloadDomainsApi.list(projectId, workloadId);
    if (request === entry.request) {
      setState(entry, () => ({ data, error: null, loading: false }));
    }
  } catch (error) {
    if (request === entry.request) {
      setState(entry, (previous) => ({
        ...previous,
        error: getApiErrorMessage(error),
        loading: false,
      }));
    }
  }
}

/**
 * Domains of a Docker service, polled while any of them waits for its DNS
 * record or certificate. `upsert` and `drop` apply a mutation's answer at
 * once, so the list never waits for the next poll.
 */
export const useWorkloadDomains = (projectId: string, workloadId: string) => {
  const key = keyOf(projectId, workloadId);

  const subscribe = useCallback(
    (listener: () => void) => {
      const entry = entryFor(key);
      entry.listeners.add(listener);
      syncPolling(entry);

      return () => {
        entry.listeners.delete(listener);
        syncPolling(entry);
      };
    },
    [key],
  );

  const state = useSyncExternalStore(
    subscribe,
    () => entryFor(key).state,
    () => INITIAL,
  );

  // Every view that mounts reads fresh data; concurrent reads collapse into
  // the latest one through the request counter.
  useEffect(() => {
    void refreshEntry(key);
  }, [key]);

  const refresh = useCallback(() => refreshEntry(key), [key]);

  const upsert = useCallback(
    (domain: WorkloadDomain) => {
      const entry = entryFor(key);
      // A poll already in flight would overwrite this with older data.
      entry.request += 1;
      setState(entry, (previous) => {
        if (!previous.data) {
          return previous;
        }

        const exists = previous.data.domains.some(({ id }) => id === domain.id);

        return {
          ...previous,
          data: {
            ...previous.data,
            domains: exists
              ? previous.data.domains.map((item) =>
                  item.id === domain.id ? domain : item,
                )
              : [...previous.data.domains, domain],
          },
        };
      });
    },
    [key],
  );

  const drop = useCallback(
    (domainId: string) => {
      const entry = entryFor(key);
      entry.request += 1;
      setState(entry, (previous) =>
        previous.data
          ? {
              ...previous,
              data: {
                ...previous.data,
                domains: previous.data.domains.filter(
                  ({ id }) => id !== domainId,
                ),
              },
            }
          : previous,
      );
    },
    [key],
  );

  return { ...state, refresh, upsert, drop };
};
