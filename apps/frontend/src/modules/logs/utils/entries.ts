import type { ProjectLogEntry } from '@acceleratio/shared';

/**
 * Adds live lines (oldest first, as the stream sends them) to the top of a
 * newest-first list, skipping lines already shown and keeping at most
 * `limit`. Returns how many lines were dropped from the bottom.
 */
export const prependLive = (
  entries: ProjectLogEntry[],
  incoming: ProjectLogEntry[],
  limit: number,
): { entries: ProjectLogEntry[]; trimmed: number } => {
  const seen = new Set(
    entries.slice(0, incoming.length * 2 + 50).map((e) => e.id),
  );
  const fresh: ProjectLogEntry[] = [];

  for (const entry of incoming) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      fresh.push(entry);
    }
  }

  if (fresh.length === 0) {
    return { entries, trimmed: 0 };
  }

  fresh.reverse();

  const merged = [...fresh, ...entries];
  const trimmed = Math.max(0, merged.length - limit);

  return {
    entries: trimmed > 0 ? merged.slice(0, limit) : merged,
    trimmed,
  };
};

/** Appends an older page under a newest-first list without repeats. */
export const appendOlder = (
  entries: ProjectLogEntry[],
  older: ProjectLogEntry[],
): ProjectLogEntry[] => {
  const tail = new Set(entries.slice(-older.length - 50).map((e) => e.id));

  return [...entries, ...older.filter((entry) => !tail.has(entry.id))];
};

/** Plain-text export of what the viewer holds, oldest line first. */
export const toLogFile = (
  entries: ProjectLogEntry[],
  serviceName: (id: string | null) => string,
): string =>
  [...entries]
    .reverse()
    .map(
      (entry) =>
        `${entry.time} ${(entry.level ?? '-').toUpperCase().padEnd(5)} ${serviceName(entry.workload_id)}/${entry.pod} ${entry.message}`,
    )
    .join('\n');
