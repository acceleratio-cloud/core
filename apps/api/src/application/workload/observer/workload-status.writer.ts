import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WorkloadStatusEvent } from '@acceleratio/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { projectNamespace } from '@/common/naming';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { DerivedWorkloadStatus } from '../docker/docker-workload.status';
import { workload, type WorkloadRow } from '../schemas/workload.schema';
import type { WorkloadStatusDeriver } from '../workload-status-deriver';
import { WorkloadStatusDeriverRegistry } from '../workload-status-deriver.registry';
import { WorkloadEventsService } from './workload-events.service';
import { WorkloadMutationGuard } from './workload-mutation-guard';
import {
  WorkloadSnapshotStore,
  type WorkloadSnapshot,
} from './workload-snapshot.store';

const DEPLOYMENT_MISSING_MESSAGE = 'Deployment is missing from the cluster';

/** How long a namespace existence probe stays cached. */
export const NAMESPACE_CACHE_TTL_MS = 5_000;

/** How often a row may be re-derived from a snapshot that moved on. */
const MAX_SNAPSHOT_ATTEMPTS = 3;

interface CachedNamespace {
  exists: boolean;
  expiresAt: number;
}

/** One consistent read of everything a status derivation depends on. */
interface Observation {
  snapshot?: WorkloadSnapshot;
  /** The Deployment part's clock, which is the mutation fence. */
  deploymentObservedAt: number;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toIsoString = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

/**
 * What the status was derived from. A difference between this value and a
 * fresh read means the snapshot moved on while the row was being derived, so
 * the persisted status would describe an object that no longer exists.
 */
const derivationInput = (snapshot: WorkloadSnapshot | undefined): string => {
  const metadata = snapshot?.deployment?.metadata;
  const deployment =
    metadata === undefined
      ? ''
      : `${metadata.uid ?? metadata.name ?? ''}/${metadata.resourceVersion ?? ''}`;
  const pods = (snapshot?.pods ?? [])
    .map(
      (pod) =>
        `${pod.metadata?.uid ?? pod.metadata?.name ?? ''}/${
          pod.status?.phase ?? ''
        }`,
    )
    .sort();

  return `${deployment}|${pods.join(',')}`;
};

/**
 * The single writer of observer-derived statuses. Every path reads the rows
 * it is about to change in one query, derives the status from the snapshot,
 * writes only when `status` or `status_message` differs and publishes one
 * event per changed row. Status events are fenced against recent user actions
 * so an in-flight watch event cannot undo an optimistic status; only the
 * Deployment part's own observation time releases that fence.
 *
 * Derivation is not instantaneous: every path awaits, and a user action or a
 * newer watch event can land while it runs. The fence and the snapshot are
 * therefore re-read immediately before the write, and the entry points are
 * serialized so two writes cannot reach the database out of order.
 */
@Injectable()
export class WorkloadStatusWriter {
  private readonly logger = new Logger(WorkloadStatusWriter.name);
  private readonly namespaces = new Map<string, CachedNamespace>();

  /** Serializes the entry points; a failed write rejects only its caller. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly snapshot: WorkloadSnapshotStore,
    private readonly guard: WorkloadMutationGuard,
    private readonly registry: WorkloadStatusDeriverRegistry,
    private readonly events: WorkloadEventsService,
    private readonly kubernetes: KubernetesService,
  ) {}

  /** Writes the statuses of the given workload ids after watch events. */
  async write(ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length === 0) {
      return;
    }

    return this.enqueue(() => this.writeRows(uniqueIds));
  }

  /**
   * Full sweep after every successful resync. Unlike `write`, it also visits
   * rows without a snapshot entry: a Deployment deleted while the API was
   * down leaves no watch event, so only the database rows can reveal it. The
   * sweep also retains only the snapshot entries the rows still back.
   */
  async reconcileAll(): Promise<void> {
    return this.enqueue(() => this.reconcileRows());
  }

  private async writeRows(ids: string[]): Promise<void> {
    const rows = await this.db
      .select()
      .from(workload)
      .where(inArray(workload.id, ids));

    for (const row of rows) {
      await this.observe(row, false);
    }
  }

  private async reconcileRows(): Promise<void> {
    // Captured before the SELECT: an event applied while the query is in
    // flight is newer than the sweep and must survive retention.
    const sweepStartedAt = Date.now();
    const rows = await this.db.select().from(workload);

    // Rows are the only thing that can back a snapshot entry. Dropping the
    // rest keeps tombstones from accumulating forever; entries touched after
    // the sweep started stay because their event may be newer than the rows.
    this.snapshot.retain(new Set(rows.map((row) => row.id)), sweepStartedAt);

    for (const row of rows) {
      await this.observe(row, true);
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(
      () => task(),
      () => task(),
    );

    this.queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  private async observe(row: WorkloadRow, fullSweep: boolean): Promise<void> {
    let observation = this.readObservation(row, fullSweep);

    if (observation === undefined) {
      return;
    }

    const deriver = this.registry.get(row.type);

    // Types without a deriver (S3 buckets) own their status; the cluster
    // snapshot has nothing to say about them.
    if (deriver === undefined) {
      this.logger.debug(
        `Skipped workload ${row.id}: no status deriver for type ${row.type}`,
      );

      return;
    }

    for (let attempt = 1; attempt <= MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const derived = await this.derive(row, observation.snapshot, deriver);

      if (derived === undefined) {
        return;
      }

      // Everything above awaited, so the user may have acted and a watch
      // event may have landed meanwhile. Re-read the fence and the snapshot
      // right before the row is written.
      const latest = this.readObservation(row, fullSweep);

      if (latest === undefined) {
        return;
      }

      if (
        latest.deploymentObservedAt !== observation.deploymentObservedAt ||
        derivationInput(latest.snapshot) !==
          derivationInput(observation.snapshot)
      ) {
        observation = latest;

        continue;
      }

      if (
        derived.status === row.status &&
        derived.status_message === row.status_message
      ) {
        return;
      }

      await this.persist(row, derived);

      return;
    }

    // The snapshot kept changing. The event that changed it schedules its own
    // write, so this stale derivation is dropped instead of persisted.
  }

  /**
   * Reads the Deployment clock and the entry the row would be derived from.
   * Returns undefined when the row must not be written: a recent user action
   * makes the observation stale, there is no entry to derive from, or only
   * the Pods of a not yet listed Deployment are known.
   *
   * The fence deliberately ignores the Pod part's clock. Every lifecycle
   * action changes the Deployment, so only a Deployment observed after the
   * mutation proves the cache caught up; a Pod event proves nothing and would
   * otherwise release the fence while the cached Deployment predates the
   * action.
   */
  private readObservation(
    row: WorkloadRow,
    fullSweep: boolean,
  ): Observation | undefined {
    const deploymentObservedAt = this.snapshot.deploymentObservedAt(row.id);
    const mutatedAt = this.guard.mutatedAt(row.id);

    if (mutatedAt > 0 && deploymentObservedAt <= mutatedAt) {
      return undefined;
    }

    const snapshot = this.snapshot.get(row.id);

    if (snapshot === undefined && !fullSweep) {
      return undefined;
    }

    // A Pod event can create an entry before the Deployment informer has
    // listed the Deployment, so its absence is not drift until a Deployment
    // event or a resync says it is. A Deployment delete sets the flag and is
    // still written immediately.
    if (
      snapshot !== undefined &&
      snapshot.deployment === undefined &&
      !snapshot.deploymentObserved &&
      !fullSweep
    ) {
      return undefined;
    }

    return { snapshot, deploymentObservedAt };
  }

  private async derive(
    row: WorkloadRow,
    snapshot: WorkloadSnapshot | undefined,
    deriver: WorkloadStatusDeriver,
  ): Promise<DerivedWorkloadStatus | undefined> {
    const deployment = snapshot?.deployment;

    return deployment === undefined
      ? await this.deriveMissing(row)
      : deriver.derive({ deployment, pods: snapshot?.pods ?? [] });
  }

  /**
   * A Deployment absent from the cluster is drift only after a deployment and
   * while the project namespace exists. A 404 means the project is being
   * deleted, so the row is left untouched; any other probe failure is logged
   * and the row is skipped.
   */
  private async deriveMissing(
    row: WorkloadRow,
  ): Promise<DerivedWorkloadStatus | undefined> {
    if (row.last_deployed_at === null) {
      return { status: 'draft', status_message: null };
    }

    const exists = await this.namespaceExists(projectNamespace(row.project_id));

    if (exists === undefined) {
      return undefined;
    }

    return exists
      ? {
          status: 'failed',
          status_message: DEPLOYMENT_MISSING_MESSAGE,
        }
      : undefined;
  }

  /**
   * Namespace probes are cached for a short window so a sweep over many rows
   * of the same project performs one cluster call. Only definitive answers
   * are cached; an error must be retried by the next row or sweep.
   */
  private async namespaceExists(
    namespace: string,
  ): Promise<boolean | undefined> {
    const now = Date.now();
    const cached = this.namespaces.get(namespace);

    if (cached !== undefined && cached.expiresAt > now) {
      return cached.exists;
    }

    try {
      await this.kubernetes.coreV1.readNamespace({ name: namespace });

      this.namespaces.set(namespace, {
        exists: true,
        expiresAt: now + NAMESPACE_CACHE_TTL_MS,
      });

      return true;
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        this.namespaces.set(namespace, {
          exists: false,
          expiresAt: now + NAMESPACE_CACHE_TTL_MS,
        });

        return false;
      }

      this.logger.warn(
        `Skipped workload status for namespace ${namespace}: ${describeError(error)}`,
      );

      return undefined;
    }
  }

  private async persist(
    row: WorkloadRow,
    derived: DerivedWorkloadStatus,
  ): Promise<void> {
    const observedAt = new Date();
    // The row read at the start of the task is the only state the derivation
    // describes. Guarding the UPDATE with it closes the last window: an
    // action that commits after the revalidation but before this statement
    // changes one of these columns, so this write matches no row instead of
    // overwriting the action.
    //
    // `updated_at` is a `timestamp` without time zone, which Drizzle reads as
    // if the stored wall clock were UTC. Binding the ISO string reproduces
    // those digits and `::timestamp` makes PostgreSQL ignore the `Z` suffix,
    // so the comparison never goes through the session timezone; binding the
    // `Date` itself would be serialised in the process timezone and match
    // nothing on a non-UTC host. Truncating to milliseconds keeps it correct
    // for rows written by `defaultNow()`, whose microseconds a JS Date cannot
    // represent.
    const stillTheObservedRow = and(
      eq(workload.id, row.id),
      eq(workload.status, row.status),
      row.status_message === null
        ? isNull(workload.status_message)
        : eq(workload.status_message, row.status_message),
      sql`date_trunc('milliseconds', ${workload.updated_at}) = ${row.updated_at.toISOString()}::timestamp`,
    );
    const [updated] = await this.db
      .update(workload)
      .set({
        status: derived.status,
        status_message: derived.status_message,
        status_observed_at: observedAt,
      })
      .where(stillTheObservedRow)
      .returning();

    // No row matched: it was deleted, or an action or another writer changed
    // it after the revalidation. Either way there is nothing to publish.
    if (updated === undefined) {
      this.logger.debug(
        `Skipped workload ${row.id}: the row changed while its status was derived`,
      );

      return;
    }

    const event: WorkloadStatusEvent = {
      type: 'status',
      workload_id: updated.id,
      project_id: updated.project_id,
      status: updated.status,
      status_message: updated.status_message,
      status_observed_at: toIsoString(updated.status_observed_at),
      updated_at: updated.updated_at.toISOString(),
    };

    this.events.publish(event);
  }
}
