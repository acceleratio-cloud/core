import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { V1Job } from '@kubernetes/client-node';
import type { StorageBenchmark } from '@acceleratio/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  storageBenchmark,
  type StorageBenchmarkRow,
} from '../schemas/storage-benchmark.schema';
import { StorageClassService } from '../storage-class.service';
import {
  ACTIVE_DEADLINE_SECONDS,
  BENCHMARK_CONTAINER,
  benchmarkExternalName,
  buildBenchmarkClaim,
  buildBenchmarkJob,
  buildBenchmarkNamespace,
  DEFAULT_BENCHMARK_IMAGE,
  DEFAULT_BENCHMARK_NAMESPACE,
} from './storage-benchmark.manifests';
import {
  benchmarkFailureMessage,
  parseBenchmarkLog,
  toStorageBenchmark,
} from './storage-benchmark.results';

const UNIQUE_VIOLATION = '23505';
const ACTIVE_CONSTRAINT = 'storage_benchmark_active_unique';
const HISTORY_LIMIT = 10;
const POLL_INTERVAL_MS = 5000;
/** The Job deadline plus time for image pulls and provisioning. */
const GIVE_UP_AFTER_MS = (ACTIVE_DEADLINE_SECONDS + 300) * 1000;

const BUSY_MESSAGE =
  'Another benchmark is running. Wait for it to finish and try again.';
const MISSING_CLASS_MESSAGE =
  'This storage profile is missing from the cluster, so it cannot be benchmarked';

const isActiveConflict = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (
    typeof current === 'object' &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };

    if (
      candidate.code === UNIQUE_VIOLATION &&
      (candidate.constraint === undefined ||
        candidate.constraint === ACTIVE_CONSTRAINT)
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
};

const ignoreNotFound = async (run: () => Promise<unknown>): Promise<void> => {
  try {
    await run();
  } catch (error) {
    if (getKubernetesStatusCode(error) !== 404) {
      throw error;
    }
  }
};

type JobOutcome = 'running' | 'succeeded' | 'failed';

export const jobOutcome = (job: V1Job): JobOutcome => {
  const conditions = job.status?.conditions ?? [];
  const has = (type: string) =>
    conditions.some(
      (condition) => condition.type === type && condition.status === 'True',
    );

  if ((job.status?.succeeded ?? 0) > 0 || has('Complete')) {
    return 'succeeded';
  }

  if ((job.status?.failed ?? 0) > 0 || has('Failed')) {
    return 'failed';
  }

  return 'running';
};

/**
 * Runs fio against a temporary volume of a storage profile. One run at a
 * time across the cluster (a partial unique index enforces it), polled by
 * this process, and resumed after a restart. The Job, the claim and the
 * volume are always removed afterwards, including for Retain profiles.
 */
@Injectable()
export class StorageBenchmarkService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(StorageBenchmarkService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kubernetes: KubernetesService,
    private readonly storageClasses: StorageClassService,
  ) {}

  get namespace(): string {
    return (
      process.env.BENCHMARK_NAMESPACE?.trim() || DEFAULT_BENCHMARK_NAMESPACE
    );
  }

  get image(): string {
    return process.env.BENCHMARK_IMAGE?.trim() || DEFAULT_BENCHMARK_IMAGE;
  }

  onApplicationBootstrap(): void {
    // Resume runs a previous process left behind; never block startup.
    void this.resumeActive().catch((error: unknown) =>
      this.logger.warn(
        `Failed to resume storage benchmarks: ${(error as Error).message}`,
      ),
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  async list(storageClassId: string): Promise<StorageBenchmark[]> {
    // 404 for an unknown profile.
    await this.storageClasses.get(storageClassId);

    const rows = await this.db
      .select()
      .from(storageBenchmark)
      .where(eq(storageBenchmark.storage_class_id, storageClassId))
      .orderBy(desc(storageBenchmark.created_at))
      .limit(HISTORY_LIMIT);

    return rows.map(toStorageBenchmark);
  }

  async start(storageClassId: string): Promise<StorageBenchmark> {
    const storageClass = await this.storageClasses.get(storageClassId);

    if (storageClass.cluster_status === 'missing') {
      throw new ConflictException(MISSING_CLASS_MESSAGE);
    }

    const id = randomUUID();
    const name = benchmarkExternalName(id);
    let row: StorageBenchmarkRow;

    try {
      [row] = await this.db
        .insert(storageBenchmark)
        .values({ id, storage_class_id: storageClassId, external_name: name })
        .returning();
    } catch (error) {
      if (isActiveConflict(error)) {
        throw new ConflictException(BUSY_MESSAGE);
      }

      throw error;
    }

    const input = {
      benchmarkId: id,
      storageClassId,
      storageClassName: storageClass.external_name,
      name,
      namespace: this.namespace,
      image: this.image,
    };

    try {
      await this.ensureNamespace();
      await this.kubernetes.coreV1.createNamespacedPersistentVolumeClaim({
        namespace: this.namespace,
        body: buildBenchmarkClaim(input),
      });
      await this.kubernetes.batchV1.createNamespacedJob({
        namespace: this.namespace,
        body: buildBenchmarkJob(input),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to start benchmark ${name}: ${(error as Error).message}`,
      );
      await this.finish(row, {
        status: 'failed',
        status_message: 'The benchmark could not be started in the cluster',
      });
      throw toNestException(error);
    }

    const [running] = await this.db
      .update(storageBenchmark)
      .set({ status: 'running', started_at: new Date() })
      .where(eq(storageBenchmark.id, id))
      .returning();

    this.schedule(id);

    return toStorageBenchmark(running ?? row);
  }

  /**
   * One poll step. Returns true when the run reached a final state (or no
   * longer exists) and needs no further polling.
   */
  async poll(id: string): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(storageBenchmark)
      .where(eq(storageBenchmark.id, id))
      .limit(1);

    if (!row || (row.status !== 'pending' && row.status !== 'running')) {
      return true;
    }

    let job: V1Job | null;

    try {
      job = await this.kubernetes.batchV1.readNamespacedJob({
        name: row.external_name,
        namespace: this.namespace,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        // Cluster hiccup: keep polling until the give-up deadline.
        return this.giveUpIfStale(row);
      }

      job = null;
    }

    if (!job) {
      await this.finish(row, {
        status: 'failed',
        status_message: 'The benchmark Job is gone from the cluster',
      });
      return true;
    }

    const outcome = jobOutcome(job);

    if (outcome === 'running') {
      return this.giveUpIfStale(row);
    }

    const log = await this.readLog(row.external_name);

    if (outcome === 'succeeded') {
      const results = log ? parseBenchmarkLog(log) : null;

      await this.finish(
        row,
        results
          ? { status: 'succeeded', results }
          : {
              status: 'failed',
              status_message: benchmarkFailureMessage(
                log,
                'The benchmark finished without readable results.',
              ),
            },
      );
      return true;
    }

    const condition = job.status?.conditions?.find(
      (item) => item.type === 'Failed' && item.status === 'True',
    );
    const fallback =
      condition?.reason === 'DeadlineExceeded'
        ? 'The benchmark did not finish in time. The volume may not have been provisioned.'
        : 'The benchmark failed.';

    await this.finish(row, {
      status: 'failed',
      status_message: benchmarkFailureMessage(log, fallback),
    });
    return true;
  }

  private async giveUpIfStale(row: StorageBenchmarkRow): Promise<boolean> {
    const since = (row.started_at ?? row.created_at).getTime();

    if (Date.now() - since < GIVE_UP_AFTER_MS) {
      return false;
    }

    await this.finish(row, {
      status: 'failed',
      status_message: 'The benchmark timed out',
    });
    return true;
  }

  private schedule(id: string): void {
    clearTimeout(this.timers.get(id));

    const timer = setTimeout(() => {
      this.timers.delete(id);
      this.poll(id)
        .then((done) => {
          if (!done) {
            this.schedule(id);
          }
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Benchmark ${id} poll failed: ${(error as Error).message}`,
          );
          this.schedule(id);
        });
    }, POLL_INTERVAL_MS);

    timer.unref();
    this.timers.set(id, timer);
  }

  private async resumeActive(): Promise<void> {
    const rows = await this.db
      .select({ id: storageBenchmark.id })
      .from(storageBenchmark)
      .where(inArray(storageBenchmark.status, ['pending', 'running']));

    for (const { id } of rows) {
      this.schedule(id);
    }
  }

  private async ensureNamespace(): Promise<void> {
    try {
      await this.kubernetes.coreV1.readNamespace({ name: this.namespace });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }

      try {
        await this.kubernetes.coreV1.createNamespace({
          body: buildBenchmarkNamespace(this.namespace),
        });
      } catch (createError) {
        // Created concurrently.
        if (getKubernetesStatusCode(createError) !== 409) {
          throw createError;
        }
      }
    }
  }

  private async readLog(name: string): Promise<string | null> {
    try {
      const pods = await this.kubernetes.coreV1.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: `job-name=${name}`,
      });
      const pod = pods.items[0]?.metadata?.name;

      if (!pod) {
        return null;
      }

      return await this.kubernetes.coreV1.readNamespacedPodLog({
        name: pod,
        namespace: this.namespace,
        container: BENCHMARK_CONTAINER,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to read benchmark log ${name}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Records the final state, then removes everything the run created. */
  private async finish(
    row: StorageBenchmarkRow,
    state: Pick<StorageBenchmarkRow, 'status'> &
      Partial<Pick<StorageBenchmarkRow, 'status_message' | 'results'>>,
  ): Promise<void> {
    await this.db
      .update(storageBenchmark)
      .set({ ...state, finished_at: new Date() })
      .where(
        and(
          eq(storageBenchmark.id, row.id),
          inArray(storageBenchmark.status, ['pending', 'running']),
        ),
      );

    await this.cleanup(row.external_name);
  }

  /**
   * Deletes the Job and the claim. The volume's reclaim policy is switched to
   * Delete first, so a Retain profile does not leave the test data behind.
   * Failures are logged: the row already holds the outcome.
   */
  private async cleanup(name: string): Promise<void> {
    const namespace = this.namespace;

    try {
      let volumeName: string | undefined;

      await ignoreNotFound(async () => {
        const claim =
          await this.kubernetes.coreV1.readNamespacedPersistentVolumeClaim({
            name,
            namespace,
          });

        volumeName = claim.spec?.volumeName;
      });

      if (volumeName) {
        const volume = volumeName;

        await ignoreNotFound(() =>
          this.kubernetes.coreV1.patchPersistentVolume({
            name: volume,
            body: [
              {
                op: 'replace',
                path: '/spec/persistentVolumeReclaimPolicy',
                value: 'Delete',
              },
            ],
          }),
        );
      }

      await ignoreNotFound(() =>
        this.kubernetes.batchV1.deleteNamespacedJob({
          name,
          namespace,
          propagationPolicy: 'Background',
        }),
      );
      await ignoreNotFound(() =>
        this.kubernetes.coreV1.deleteNamespacedPersistentVolumeClaim({
          name,
          namespace,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to clean up benchmark ${name}: ${(error as Error).message}`,
      );
    }
  }
}
