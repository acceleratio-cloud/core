import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { V1Job } from '@kubernetes/client-node';
import { and, asc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import { jobOutcome } from '@/vendor/kubernetes/job-outcome';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  SCAN_CONTAINER,
  scanCacheClaim,
  scanJob,
  scanJobName,
  scanMemoryLimit,
  scanNamespace,
  scanNamespaceManifest,
  scanPolicy,
  scanTarget,
  scanTimeoutSeconds,
} from './image-scan.manifests';
import { imageScan, type ImageScanRow } from './schemas/image-scan.schema';
import { parseScanOutput, scanFailureLine } from './scan-output';

const UNIQUE_VIOLATION = '23505';
const ACTIVE_CONSTRAINT = 'image_scan_active_unique';
const TICK_MS = 5_000;
/** A scan of an image still in use is redone after this: the database grows. */
const RESCAN_AFTER = sql`interval '24 hours'`;
/** Scans of images no pod has run for this long are deleted. */
const PRUNE_AFTER = sql`interval '7 days'`;
/** Past the Job's own deadline, the API stops waiting for it. */
const giveUpMs = () => (scanTimeoutSeconds() + 5 * 60) * 1000;

export interface TrackedImage {
  digest: string;
  image_id: string;
}

/** True when the insert lost the one-scan-at-a-time race. */
const isActiveConflict = (error: unknown): boolean => {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown };

    if (
      candidate.code === UNIQUE_VIOLATION &&
      (candidate.constraint === undefined ||
        candidate.constraint === ACTIVE_CONSTRAINT)
    ) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
};

/**
 * The scan queue. Every image a service runs gets a row keyed by digest; one
 * Trivy Job runs at a time across the cluster, in its own namespace with a
 * cache volume for the vulnerability database. The queue lives in the
 * database, so it survives a restart and several API processes share it.
 */
@Injectable()
export class ImageScanService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ImageScanService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private ticking = false;
  private stopped = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kubernetes: KubernetesService,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(TICK_MS);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /**
   * Records that these images run now: new ones join the queue, and finished
   * scans older than a day go back to it.
   */
  async track(images: TrackedImage[]): Promise<ImageScanRow[]> {
    const unique = [
      ...new Map(images.map((item) => [item.digest, item])).values(),
    ];

    if (unique.length === 0) {
      return [];
    }

    const digests = unique.map((item) => item.digest);

    await this.db
      .insert(imageScan)
      .values(
        unique.map((item) => ({
          id: randomUUID(),
          digest: item.digest,
          image: item.image_id,
        })),
      )
      .onConflictDoUpdate({
        target: imageScan.digest,
        set: {
          last_seen_at: sql`now()`,
          image: sql`excluded.image`,
          // The column's $onUpdate names a bare `updated_at`, ambiguous next to `excluded`.
          updated_at: sql`now()`,
        },
      });

    const requeued = await this.db
      .update(imageScan)
      .set({ status: 'pending', requested_at: sql`now()` })
      .where(
        and(
          inArray(imageScan.digest, digests),
          inArray(imageScan.status, ['succeeded', 'failed']),
          lt(imageScan.finished_at, sql`now() - ${RESCAN_AFTER}`),
        ),
      )
      .returning({ id: imageScan.id });
    const rows = await this.rows(digests);

    if (requeued.length > 0 || rows.some((row) => row.status === 'pending')) {
      this.kick();
    }

    return rows;
  }

  /** Queues the images again now, unless they already wait or run. */
  async rescan(digests: string[]): Promise<void> {
    if (digests.length === 0) {
      return;
    }

    await this.db
      .update(imageScan)
      .set({ status: 'pending', requested_at: sql`now()` })
      .where(
        and(
          inArray(imageScan.digest, digests),
          inArray(imageScan.status, ['succeeded', 'failed']),
        ),
      );
    this.kick();
  }

  rows(digests: string[]): Promise<ImageScanRow[]> {
    return digests.length === 0
      ? Promise.resolve([])
      : this.db
          .select()
          .from(imageScan)
          .where(inArray(imageScan.digest, digests));
  }

  /** Deletes scans of images no service has run for a week. */
  async prune(): Promise<void> {
    await this.db
      .delete(imageScan)
      .where(
        and(
          ne(imageScan.status, 'scanning'),
          lt(imageScan.last_seen_at, sql`now() - ${PRUNE_AFTER}`),
        ),
      );
  }

  /** Runs the next step soon instead of on the regular tick. */
  private kick(): void {
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopped) {
      return;
    }

    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule(TICK_MS));
    }, delay);
  }

  /** Polls the running scan; when none runs, starts the oldest pending one. */
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }

    this.ticking = true;

    try {
      const [active] = await this.db
        .select()
        .from(imageScan)
        .where(eq(imageScan.status, 'scanning'))
        .limit(1);

      if (active && !(await this.poll(active))) {
        return;
      }

      const [next] = await this.db
        .select()
        .from(imageScan)
        .where(eq(imageScan.status, 'pending'))
        .orderBy(asc(imageScan.requested_at))
        .limit(1);

      if (next) {
        await this.start(next);
      }
    } catch (error) {
      this.logger.warn(`Scan queue step failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async start(row: ImageScanRow): Promise<void> {
    const target = scanTarget(row.image);

    if (!target) {
      await this.finish(row.id, {
        status: 'failed',
        status_message: 'This image reference cannot be scanned',
      });
      return;
    }

    // A name per run: the previous run's Job of this image lives on for an hour.
    const name = scanJobName(randomUUID());
    const namespace = scanNamespace();

    try {
      const [claimed] = await this.db
        .update(imageScan)
        .set({
          status: 'scanning',
          status_message: null,
          external_name: name,
          started_at: sql`now()`,
        })
        .where(and(eq(imageScan.id, row.id), eq(imageScan.status, 'pending')))
        .returning({ id: imageScan.id });

      if (!claimed) {
        return;
      }
    } catch (error) {
      // Another process started a scan first.
      if (isActiveConflict(error)) {
        return;
      }
      throw error;
    }

    try {
      await this.ensureNamespace(namespace);
      await this.kubernetes.batchV1.createNamespacedJob({
        namespace,
        body: scanJob({
          scanId: row.id,
          name,
          namespace,
          digest: row.digest,
          ...target,
        }),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to start scan ${name}: ${(error as Error).message}`,
      );
      await this.finish(row.id, {
        status: 'failed',
        status_message: 'The scan could not be started in the cluster',
      });
    }
  }

  /** One poll step; true when the scan ended and the queue can move on. */
  private async poll(row: ImageScanRow): Promise<boolean> {
    const namespace = scanNamespace();
    let job: V1Job | null;

    try {
      job = await this.kubernetes.batchV1.readNamespacedJob({
        name: row.external_name ?? '',
        namespace,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        // Cluster hiccup: keep waiting until the give-up deadline.
        return this.giveUpIfStale(row);
      }

      job = null;
    }

    if (!job) {
      await this.finish(row.id, {
        status: 'failed',
        status_message: 'The scan Job is gone from the cluster',
      });
      return true;
    }

    const outcome = jobOutcome(job);

    if (outcome === 'running') {
      return this.giveUpIfStale(row);
    }

    const pod = await this.readPod(row.external_name ?? '');

    if (outcome === 'succeeded' && pod.log !== null) {
      const result = parseScanOutput(pod.log);

      await this.finish(row.id, {
        status: 'succeeded',
        status_message: null,
        counts: result.counts,
        fixable: result.fixable,
        vulnerabilities: result.vulnerabilities,
      });
      return true;
    }

    const deadline = job.status?.conditions?.some(
      (condition) => condition.reason === 'DeadlineExceeded',
    );

    await this.finish(row.id, {
      status: 'failed',
      status_message: pod.oomKilled
        ? `The scanner ran out of its ${scanMemoryLimit().quantity} memory on this image`
        : deadline
          ? `The scan ran longer than ${scanTimeoutSeconds() / 60} minutes`
          : (scanFailureLine(pod.log) ?? 'The scan failed'),
    });

    return true;
  }

  private async giveUpIfStale(row: ImageScanRow): Promise<boolean> {
    if (row.started_at && Date.now() - row.started_at.getTime() > giveUpMs()) {
      await this.finish(row.id, {
        status: 'failed',
        status_message: 'The scan did not finish in time',
      });
      return true;
    }

    return false;
  }

  private async finish(
    id: string,
    values: Partial<
      Pick<
        ImageScanRow,
        'status' | 'status_message' | 'counts' | 'fixable' | 'vulnerabilities'
      >
    >,
  ): Promise<void> {
    await this.db
      .update(imageScan)
      .set({ ...values, finished_at: sql`now()` })
      .where(eq(imageScan.id, id));
  }

  private async readPod(
    jobName: string,
  ): Promise<{ log: string | null; oomKilled: boolean }> {
    const namespace = scanNamespace();

    try {
      const pods = await this.kubernetes.coreV1.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      const pod = pods.items[0];

      if (!pod?.metadata?.name) {
        return { log: null, oomKilled: false };
      }

      const oomKilled =
        pod.status?.containerStatuses?.find(
          (status) => status.name === SCAN_CONTAINER,
        )?.state?.terminated?.reason === 'OOMKilled';
      const log = await this.kubernetes.coreV1.readNamespacedPodLog({
        name: pod.metadata.name,
        namespace,
        container: SCAN_CONTAINER,
      });

      return { log, oomKilled };
    } catch (error) {
      this.logger.warn(
        `Failed to read scan log ${jobName}: ${(error as Error).message}`,
      );
      return { log: null, oomKilled: false };
    }
  }

  /** The namespace, its network policy and the cache volume, on first use. */
  private async ensureNamespace(namespace: string): Promise<void> {
    const create = async (request: () => Promise<unknown>) => {
      try {
        await request();
      } catch (error) {
        if (getKubernetesStatusCode(error) !== 409) {
          throw error;
        }
      }
    };

    await create(() =>
      this.kubernetes.coreV1.createNamespace({
        body: scanNamespaceManifest(namespace),
      }),
    );
    await create(() =>
      this.kubernetes.customObjects.createNamespacedCustomObject({
        group: 'cilium.io',
        version: 'v2',
        namespace,
        plural: 'ciliumnetworkpolicies',
        body: scanPolicy(namespace),
      }),
    );
    await create(() =>
      this.kubernetes.coreV1.createNamespacedPersistentVolumeClaim({
        namespace,
        body: scanCacheClaim(namespace),
      }),
    );
  }
}
