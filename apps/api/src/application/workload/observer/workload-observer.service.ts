import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Informer, V1Deployment, V1Pod } from '@kubernetes/client-node';
import { KubernetesWatchService } from '@/vendor/kubernetes/kubernetes-watch.service';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  WORKLOAD_ID_LABEL,
} from '../docker/docker-workload.manifests';
import { WorkloadSnapshotStore, workloadIdOf } from './workload-snapshot.store';
import { WorkloadStatusWriter } from './workload-status.writer';

const DEFAULT_RESYNC_MS = 60_000;
const DEBOUNCE_MS = 250;
const MAX_WAIT_MS = 1_000;
const RESTART_BASE_MS = 1_000;
const RESTART_MAX_MS = 30_000;

export const DEPLOYMENT_SELECTOR = `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}`;
export const POD_SELECTOR = WORKLOAD_ID_LABEL;

const KINDS = ['deployments', 'pods'] as const;
const WATCH_EVENTS: WatchEvent[] = ['add', 'update', 'delete'];

type WorkloadKind = (typeof KINDS)[number];
type WatchEvent = 'add' | 'update' | 'delete';
type WorkloadInformer = Informer<V1Deployment> | Informer<V1Pod>;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const observerEnabled = (): boolean =>
  process.env.WORKLOAD_OBSERVER_ENABLED?.trim().toLowerCase() !== 'false';

const resyncIntervalMs = (): number => {
  const configured = Number(
    (process.env.WORKLOAD_OBSERVER_RESYNC_MS ?? '').trim(),
  );

  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_RESYNC_MS;
};

/**
 * Watches Deployments and Pods cluster-wide, keeps the in-memory snapshot in
 * sync and hands changed workload ids to the single status writer.
 *
 * The store's `workloadIdOf` validates the id label, so an object whose label
 * is missing or not a canonical UUID never reaches the snapshot or the
 * writer's batched SQL.
 *
 * Watch failures never fail bootstrap: each informer is supervised and
 * restarted with exponential backoff while an independent resync converges
 * the snapshot and database every interval.
 */
@Injectable()
export class WorkloadObserverService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkloadObserverService.name);

  private readonly informers: {
    deployments?: Informer<V1Deployment>;
    pods?: Informer<V1Pod>;
  } = {};

  private readonly restartTimers: Partial<
    Record<WorkloadKind, ReturnType<typeof setTimeout>>
  > = {};

  private readonly restartAttempts: Record<WorkloadKind, number> = {
    deployments: 0,
    pods: 0,
  };

  private readonly dirty = new Set<string>();

  private debounceTimer?: ReturnType<typeof setTimeout>;
  private maxWaitTimer?: ReturnType<typeof setTimeout>;
  private resyncTimer?: ReturnType<typeof setInterval>;
  private started = false;
  private stopped = false;
  private resyncing = false;

  constructor(
    private readonly watch: KubernetesWatchService,
    private readonly snapshot: WorkloadSnapshotStore,
    private readonly writer: WorkloadStatusWriter,
  ) {}

  onApplicationBootstrap(): void {
    if (!observerEnabled()) {
      this.logger.log('Workload observer is disabled');

      return;
    }

    void this.start().catch((error: unknown) => {
      this.logger.error(
        `Workload observer failed to start: ${describeError(error)}`,
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (this.started || this.stopped || !observerEnabled()) {
      return;
    }

    this.started = true;
    this.logger.log(
      `Starting workload observer with a ${resyncIntervalMs()} ms resync`,
    );

    this.startInformerSafely('deployments');
    this.startInformerSafely('pods');

    await this.resync();

    if (this.stopped) {
      return;
    }

    this.resyncTimer = setInterval(() => {
      void this.resync();
    }, resyncIntervalMs());
    this.resyncTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.logger.log('Stopping workload observer');

    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    if (this.maxWaitTimer !== undefined) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = undefined;
    }

    if (this.resyncTimer !== undefined) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = undefined;
    }

    for (const kind of KINDS) {
      const timer = this.restartTimers[kind];

      if (timer !== undefined) {
        clearTimeout(timer);
        delete this.restartTimers[kind];
      }
    }

    this.dirty.clear();

    const informers = [this.informers.deployments, this.informers.pods].filter(
      (informer): informer is WorkloadInformer => !!informer,
    );

    this.informers.deployments = undefined;
    this.informers.pods = undefined;

    await Promise.all(
      informers.map((informer) =>
        informer.stop().catch((error: unknown) => {
          this.logger.warn(
            `Could not stop a workload informer: ${describeError(error)}`,
          );
        }),
      ),
    );
  }

  // Bootstrap and the resync interval must not depend on watch health, so
  // informer startup is never awaited.
  private startInformerSafely(kind: WorkloadKind): void {
    void this.startInformer(kind).catch((error: unknown) => {
      this.logger.error(
        `Could not start the ${kind} informer: ${describeError(error)}`,
      );
      this.scheduleRestart(kind);
    });
  }

  private async startInformer(kind: WorkloadKind): Promise<void> {
    if (this.stopped) {
      return;
    }

    if (kind === 'deployments') {
      let informer: Informer<V1Deployment>;

      try {
        informer = this.watch.createDeploymentInformer(DEPLOYMENT_SELECTOR);
      } catch (error) {
        this.handleCreateFailure(kind, error);

        return;
      }

      this.informers.deployments = informer;
      this.subscribeDeploymentInformer(informer);
      await this.launchInformer(kind, informer);

      return;
    }

    let informer: Informer<V1Pod>;

    try {
      informer = this.watch.createPodInformer(POD_SELECTOR);
    } catch (error) {
      this.handleCreateFailure(kind, error);

      return;
    }

    this.informers.pods = informer;
    this.subscribePodInformer(informer);
    await this.launchInformer(kind, informer);
  }

  private subscribeDeploymentInformer(informer: Informer<V1Deployment>): void {
    for (const event of WATCH_EVENTS) {
      informer.on(event, (deployment) => {
        this.observeDeployment(event, informer, deployment);
      });
    }

    informer.on('error', (error) => {
      this.handleInformerError('deployments', informer, error);
    });
  }

  private subscribePodInformer(informer: Informer<V1Pod>): void {
    for (const event of WATCH_EVENTS) {
      informer.on(event, (pod) => {
        this.observePod(event, informer, pod);
      });
    }

    informer.on('error', (error) => {
      this.handleInformerError('pods', informer, error);
    });
  }

  private observeDeployment(
    event: WatchEvent,
    informer: Informer<V1Deployment>,
    deployment: V1Deployment,
  ): void {
    if (!this.isCurrent('deployments', informer)) {
      return;
    }

    this.snapshot.applyDeployment(event, deployment);
    this.observeResource(deployment);
  }

  private observePod(
    event: WatchEvent,
    informer: Informer<V1Pod>,
    pod: V1Pod,
  ): void {
    if (!this.isCurrent('pods', informer)) {
      return;
    }

    this.snapshot.applyPod(event, pod);
    this.observeResource(pod);
  }

  private observeResource(resource: V1Deployment | V1Pod): void {
    // Every (re)connect replays the whole initial list as `add` events, so an
    // event says nothing about watch health. Only `launchInformer` may reset
    // the restart counter, and only once the informer is still attached after
    // a successful start.
    const id = workloadIdOf(resource);

    if (id === undefined) {
      return;
    }

    this.markDirty(id);
  }

  private async launchInformer(
    kind: WorkloadKind,
    informer: WorkloadInformer,
  ): Promise<void> {
    try {
      await informer.start();
    } catch (error) {
      this.logger.error(
        `The ${kind} informer failed to start: ${describeError(error)}`,
      );
      this.detachInformer(kind, informer);

      return;
    }

    // ListWatch reports a failed initial list through `error` and resolves
    // `start`, so a resolved start only proves the watch is healthy while the
    // informer is still the attached one.
    if (!this.stopped && this.informers[kind] === informer) {
      this.restartAttempts[kind] = 0;
    }
  }

  private handleCreateFailure(kind: WorkloadKind, error: unknown): void {
    this.logger.error(
      `Could not create the ${kind} informer: ${describeError(error)}`,
    );
    this.scheduleRestart(kind);
  }

  private handleInformerError(
    kind: WorkloadKind,
    informer: WorkloadInformer,
    error: unknown,
  ): void {
    if (this.stopped || this.informers[kind] !== informer) {
      return;
    }

    this.logger.error(
      `The ${kind} informer stopped with an error: ${describeError(error)}`,
    );
    this.detachInformer(kind, informer);
  }

  private detachInformer(kind: WorkloadKind, informer: WorkloadInformer): void {
    if (this.informers[kind] === informer) {
      this.informers[kind] = undefined;
    }

    void informer.stop().catch((error: unknown) => {
      this.logger.warn(
        `Could not stop the ${kind} informer: ${describeError(error)}`,
      );
    });

    this.scheduleRestart(kind);
  }

  private scheduleRestart(kind: WorkloadKind): void {
    if (this.stopped || this.restartTimers[kind] !== undefined) {
      return;
    }

    const attempt = this.restartAttempts[kind];
    const delay = Math.min(RESTART_BASE_MS * 2 ** attempt, RESTART_MAX_MS);

    this.restartAttempts[kind] = attempt + 1;
    this.logger.warn(`Restarting the ${kind} informer in ${delay} ms`);

    const timer = setTimeout(() => {
      delete this.restartTimers[kind];

      if (this.stopped) {
        return;
      }

      this.startInformerSafely(kind);
    }, delay);

    timer.unref?.();
    this.restartTimers[kind] = timer;
  }

  private markDirty(id: string): void {
    if (this.stopped) {
      return;
    }

    this.dirty.add(id);

    if (this.maxWaitTimer === undefined) {
      this.maxWaitTimer = setTimeout(() => this.flush(), MAX_WAIT_MS);
      this.maxWaitTimer.unref?.();
    }

    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => this.flush(), DEBOUNCE_MS);
    this.debounceTimer.unref?.();
  }

  private flush(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    if (this.maxWaitTimer !== undefined) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = undefined;
    }

    if (this.stopped || this.dirty.size === 0) {
      return;
    }

    const ids = [...this.dirty];

    // Clearing before the write lets events that arrive mid-write schedule
    // the next flush instead of being dropped with this batch.
    this.dirty.clear();

    void this.writer.write(ids).catch((error: unknown) => {
      this.logger.error(
        `Workload status write failed: ${describeError(error)}`,
      );
    });
  }

  private async resync(): Promise<void> {
    if (this.stopped || this.resyncing) {
      return;
    }

    this.resyncing = true;

    try {
      // The stamp is taken before the requests, not after the responses: a
      // watch event applied while the lists are in flight is newer than what
      // they return, and the merge must keep it.
      const listedAt = Date.now();
      const [deployments, pods] = await Promise.all([
        this.watch.listDeployments(DEPLOYMENT_SELECTOR),
        this.watch.listPods(POD_SELECTOR),
      ]);

      if (this.stopped) {
        return;
      }

      this.snapshot.replaceAll(deployments, pods, listedAt);

      if (this.stopped) {
        return;
      }

      await this.writer.reconcileAll();
    } catch (error) {
      this.logger.error(
        `Workload observer resync failed: ${describeError(error)}`,
      );
    } finally {
      this.resyncing = false;
    }
  }

  private isCurrent(kind: WorkloadKind, informer: WorkloadInformer): boolean {
    return !this.stopped && this.informers[kind] === informer;
  }
}
