import { Injectable } from '@nestjs/common';

/** How long a user action can fence observer writes for its workload. */
const MUTATION_TTL_MS = 5 * 60 * 1000;

/**
 * Records when a lifecycle action (deploy, start, stop, restart) last touched
 * a workload. The writer skips a row when the observer's last observation is
 * at or before the recorded mutation, so an in-flight watch event cannot undo
 * the optimistic status.
 *
 * The map is pruned lazily on write and on read; no timer is needed.
 */
@Injectable()
export class WorkloadMutationGuard {
  private readonly mutations = new Map<string, number>();

  noteMutation(id: string): void {
    const now = Date.now();

    this.prune(now);
    this.mutations.set(id, now);
  }

  mutatedAt(id: string): number {
    const timestamp = this.mutations.get(id);

    if (timestamp === undefined) {
      return 0;
    }

    if (Date.now() - timestamp > MUTATION_TTL_MS) {
      this.mutations.delete(id);

      return 0;
    }

    return timestamp;
  }

  private prune(now: number): void {
    for (const [id, timestamp] of this.mutations) {
      if (now - timestamp > MUTATION_TTL_MS) {
        this.mutations.delete(id);
      }
    }
  }
}
