import { Inject, Injectable, Logger } from '@nestjs/common';
import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import type { WorkloadStatus, WorkloadStatusEvent } from '@acceleratio/shared';
import { inArray } from 'drizzle-orm';
import { projectNamespace } from '@/common/naming';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { WORKLOAD_ID_LABEL } from '../docker/docker-workload.manifests';
import { workload, type WorkloadRow } from '../schemas/workload.schema';
import { WorkloadStatusDeriverRegistry } from '../workload-status-deriver.registry';
import { WorkloadEventsService } from './workload-events.service';
import { WorkloadSnapshotStore } from './workload-snapshot.store';

export const DEPLOYMENT_MISSING_MESSAGE =
  'Deployment is missing from the cluster';
export const CLUSTER_UNREADABLE_MESSAGE =
  'The workload could not be read from the cluster';

/** What a status read returns; the API contract carries these three fields. */
export interface WorkloadStatusView {
  status: WorkloadStatus;
  status_message: string | null;
  /** When the cluster state behind the status was last observed. */
  status_observed_at: string | null;
}

/** The columns a status derivation depends on. */
export type WorkloadStatusRow = Pick<
  WorkloadRow,
  | 'id'
  | 'project_id'
  | 'type'
  | 'external_name'
  | 'last_deployed_at'
  | 'updated_at'
>;

const statusColumns = {
  id: workload.id,
  project_id: workload.project_id,
  type: workload.type,
  external_name: workload.external_name,
  last_deployed_at: workload.last_deployed_at,
  updated_at: workload.updated_at,
};

export const DRAFT_STATUS: WorkloadStatusView = {
  status: 'draft',
  status_message: null,
  status_observed_at: null,
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const statusKey = (view: WorkloadStatusView): string =>
  `${view.status}|${view.status_message ?? ''}`;

/**
 * Derives a workload's status from the cluster at read time. The database
 * holds what the operator asked for; what is actually happening is read from
 * the observer's in-memory snapshot of Deployments and Pods, so there is no
 * stored copy that can disagree with the cluster.
 *
 * The same service turns snapshot changes into status events. It remembers the
 * last status it announced per workload and publishes only on a difference,
 * which is what a stored status column used to do.
 */
@Injectable()
export class WorkloadStatusService {
  private readonly logger = new Logger(WorkloadStatusService.name);

  /** Last announced `status|message` per workload id. */
  private readonly announced = new Map<string, string>();

  /** Serializes the announce paths so events leave in the order they were derived. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly snapshot: WorkloadSnapshotStore,
    private readonly registry: WorkloadStatusDeriverRegistry,
    private readonly events: WorkloadEventsService,
    private readonly kubernetes: KubernetesService,
  ) {}

  /** The status of one workload, derived now. */
  async resolve(row: WorkloadStatusRow): Promise<WorkloadStatusView> {
    const deriver = this.registry.get(row.type);

    if (deriver === undefined) {
      return DRAFT_STATUS;
    }

    const known = this.snapshot.get(row.id);

    if (known?.deployment !== undefined) {
      return this.derive(row, known.deployment, known.pods, true);
    }

    // The snapshot answers "no Deployment" only once it has listed the
    // cluster, or saw this workload's Deployment disappear.
    if (known?.deploymentObserved || this.snapshot.isReady()) {
      return this.missing(row);
    }

    if (row.last_deployed_at === null) {
      return DRAFT_STATUS;
    }

    return this.readFromCluster(row);
  }

  /** Statuses of many workloads, keyed by id. */
  async resolveAll(
    rows: WorkloadStatusRow[],
  ): Promise<Map<string, WorkloadStatusView>> {
    const views = await Promise.all(rows.map((row) => this.resolve(row)));

    return new Map(rows.map((row, index) => [row.id, views[index]]));
  }

  /**
   * Puts a Deployment the API just applied into the snapshot, so the next
   * read reflects the action without waiting for the watch event.
   */
  applyDeployment(deployment: V1Deployment): void {
    this.snapshot.applyDeployment('update', deployment);
  }

  /** Reads the status after an action and publishes it. */
  async announce(row: WorkloadStatusRow): Promise<WorkloadStatusView> {
    const view = await this.resolve(row);

    this.publish(row, view);

    return view;
  }

  /** Forgets a deleted workload. */
  forget(id: string): void {
    this.announced.delete(id);
  }

  /** Publishes the workloads whose derived status differs from the last one. */
  async announceChanges(ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length === 0) {
      return;
    }

    return this.enqueue(async () => {
      const rows = await this.db
        .select(statusColumns)
        .from(workload)
        .where(inArray(workload.id, uniqueIds));

      for (const row of rows) {
        await this.announceRow(row, false);
      }
    });
  }

  /**
   * Full pass after a resync. Unknown workloads are remembered without an
   * event (the console loaded them with their status); known ones whose
   * status moved are published. Entries of deleted workloads are dropped.
   */
  async reconcileAll(): Promise<void> {
    return this.enqueue(async () => {
      const startedAt = Date.now();
      const rows = await this.db.select(statusColumns).from(workload);
      const ids = new Set(rows.map((row) => row.id));

      for (const row of rows) {
        await this.announceRow(row, true);
      }

      for (const id of [...this.announced.keys()]) {
        if (!ids.has(id)) {
          this.announced.delete(id);
        }
      }

      this.snapshot.retain(ids, startedAt);
    });
  }

  private async announceRow(
    row: WorkloadStatusRow,
    seedOnly: boolean,
  ): Promise<void> {
    if (this.registry.get(row.type) === undefined) {
      return;
    }

    const view = await this.resolve(row);
    const key = statusKey(view);
    const previous = this.announced.get(row.id);

    if (previous === key) {
      return;
    }

    if (previous === undefined && seedOnly) {
      this.announced.set(row.id, key);

      return;
    }

    this.publish(row, view);
  }

  private publish(row: WorkloadStatusRow, view: WorkloadStatusView): void {
    this.announced.set(row.id, statusKey(view));

    const event: WorkloadStatusEvent = {
      type: 'status',
      workload_id: row.id,
      project_id: row.project_id,
      status: view.status,
      status_message: view.status_message,
      status_observed_at: view.status_observed_at,
      updated_at: row.updated_at.toISOString(),
    };

    this.events.publish(event);
  }

  private async derive(
    row: WorkloadStatusRow,
    deployment: V1Deployment,
    pods: V1Pod[],
    fromSnapshot: boolean,
  ): Promise<WorkloadStatusView> {
    const deriver = this.registry.get(row.type)!;
    const derived = await deriver.derive({ deployment, pods });
    const observedAt = fromSnapshot
      ? this.snapshot.deploymentObservedAt(row.id)
      : Date.now();

    return {
      ...derived,
      status_observed_at:
        observedAt > 0 ? new Date(observedAt).toISOString() : null,
    };
  }

  private missing(row: WorkloadStatusRow): WorkloadStatusView {
    if (row.last_deployed_at === null) {
      return DRAFT_STATUS;
    }

    return {
      status: 'failed',
      status_message: DEPLOYMENT_MISSING_MESSAGE,
      status_observed_at: new Date(
        this.snapshot.deploymentObservedAt(row.id) || Date.now(),
      ).toISOString(),
    };
  }

  /**
   * The fallback while the snapshot has not listed the cluster yet, or when
   * the observer is disabled: ask the cluster directly.
   */
  private async readFromCluster(
    row: WorkloadStatusRow,
  ): Promise<WorkloadStatusView> {
    const namespace = projectNamespace(row.project_id);

    try {
      const deployment = await this.kubernetes.appsV1.readNamespacedDeployment({
        name: row.external_name,
        namespace,
      });
      const pods = await this.kubernetes.coreV1.listNamespacedPod({
        namespace,
        labelSelector: `${WORKLOAD_ID_LABEL}=${row.id}`,
      });

      return await this.derive(row, deployment, pods.items ?? [], false);
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return this.missing(row);
      }

      this.logger.warn(
        `Could not read workload ${row.id} from the cluster: ${describeError(error)}`,
      );

      return {
        status: 'failed',
        status_message: CLUSTER_UNREADABLE_MESSAGE,
        status_observed_at: null,
      };
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);

    this.queue = run.catch(() => undefined);

    return run;
  }
}
