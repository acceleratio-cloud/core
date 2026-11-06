import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { V1ConfigMap, V1Job } from '@kubernetes/client-node';
import type {
  PlatformUpdate,
  PlatformUpdateDetails,
  PlatformUpdateStage,
  PlatformUpdateStatus,
  PlatformVersionInfo,
  StartPlatformUpdatePayload,
} from '@acceleratio/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { jobOutcome } from '@/vendor/kubernetes/job-outcome';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { newerReleases, releaseDownloadBase } from './platform-release.parse';
import { PlatformReleaseService } from './platform-release.service';
import {
  DEFAULT_CONFIG_DIR,
  DEFAULT_UPDATE_ROOT,
  LAUNCHER_CONTAINER,
  buildUpdateJob,
  updateExternalName,
} from './platform-update.manifests';
import {
  cleanLog,
  isFinalPhase,
  isUpdateStage,
  launcherFailureMessage,
  parseReportedStatus,
  statusOfPhase,
} from './platform-update.status';
import { PlatformVersionService } from './platform-version.service';
import { compareVersions, normalizeVersion } from './platform-version.semver';
import {
  platformUpdate,
  type PlatformUpdateRow,
} from './schemas/platform-update.schema';

const ACTIVE_STATUSES: PlatformUpdateStatus[] = ['pending', 'running'];
const ACTIVE_CONSTRAINT = 'platform_update_active_unique';
const UNIQUE_VIOLATION = '23505';

const POLL_INTERVAL_MS = 3000;
/** The runner must report within this time after the launcher started. */
const START_TIMEOUT_MS = 10 * 60 * 1000;
/** A running update that stops reporting for this long is given up. */
const SILENCE_TIMEOUT_MS = 45 * 60 * 1000;
const HISTORY_LIMIT = 20;

export const UPDATE_IN_PROGRESS_MESSAGE = 'An update is already running';
export const DEV_BUILD_MESSAGE =
  'This API does not report a release version (development build). Updates from the console need an installation made with deploy/install.sh.';
export const OUT_OF_CLUSTER_MESSAGE =
  'The API does not run inside the cluster it manages, so it cannot update it. Use deploy/update.sh on the server.';
export const UPDATES_DISABLED_MESSAGE =
  'Updates from the console are turned off on this installation (PLATFORM_UPDATES_ENABLED=0).';
export const UNKNOWN_RELEASE_MESSAGE =
  'This version is not a stable release newer than the running one. Check for updates and pick a listed version.';
export const SILENCE_MESSAGE =
  'The server stopped reporting progress. Check the update on the server: journalctl -u acceleratio-update and /var/log/acceleratio/update.log.';
export const NOT_STARTED_MESSAGE =
  'The update did not start on the server within 10 minutes.';

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

const toIso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

export const toPlatformUpdate = (row: PlatformUpdateRow): PlatformUpdate => ({
  id: row.id,
  from_version: row.from_version,
  to_version: row.to_version,
  status: row.status,
  stage: row.stage && isUpdateStage(row.stage) ? row.stage : null,
  message: row.message,
  actor: row.actor,
  started_at: row.started_at.toISOString(),
  finished_at: toIso(row.finished_at),
  reported_at: toIso(row.reported_at),
});

type RowPatch = Partial<
  Pick<
    PlatformUpdateRow,
    'status' | 'stage' | 'message' | 'log' | 'reported_at' | 'finished_at'
  >
>;

/**
 * Updates the platform from the console. A launcher Job hands the update to
 * a systemd unit on the installation's server, which runs the release's
 * update.sh and publishes progress to a ConfigMap. This service copies that
 * progress into `platform_update`, so the status outlives the API Pod that
 * the update replaces; the new API resumes polling where the old one stopped.
 */
@Injectable()
export class PlatformUpdateService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PlatformUpdateService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly configDir =
    process.env.ACCELERATIO_CONFIG_DIR?.trim() || DEFAULT_CONFIG_DIR;
  private readonly updateRoot =
    process.env.PLATFORM_UPDATE_ROOT?.trim() || DEFAULT_UPDATE_ROOT;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kubernetes: KubernetesService,
    private readonly releases: PlatformReleaseService,
    private readonly versions: PlatformVersionService,
  ) {}

  onApplicationBootstrap(): void {
    this.resumeActive().catch((error: unknown) => {
      this.logger.warn(
        `Failed to resume platform updates: ${(error as Error).message}`,
      );
    });
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  async info(): Promise<PlatformVersionInfo> {
    const [current, components, check, active, last] = await Promise.all([
      this.versions.currentVersion(),
      this.versions.components(),
      this.releases.read(),
      this.findActive(),
      this.findLastFinished(),
    ]);
    const releases = newerReleases(check?.releases ?? [], current);

    return {
      current_version: current,
      components,
      latest_version: check?.latest_version ?? null,
      update_available: releases.length > 0,
      releases: releases.map(({ version, name, notes, url, published_at }) => ({
        version,
        name,
        notes,
        url,
        published_at,
      })),
      checked_at: toIso(check?.checked_at ?? null),
      check_error: check?.error ?? null,
      release_source: this.releases.source,
      update_blocked_reason: active
        ? UPDATE_IN_PROGRESS_MESSAGE
        : this.blockedReason(current),
      active_update: active ? toPlatformUpdate(active) : null,
      last_update: last ? toPlatformUpdate(last) : null,
    };
  }

  async check(): Promise<PlatformVersionInfo> {
    await this.releases.checkNow();
    return this.info();
  }

  async list(): Promise<PlatformUpdate[]> {
    const rows = await this.db
      .select()
      .from(platformUpdate)
      .orderBy(desc(platformUpdate.started_at))
      .limit(HISTORY_LIMIT);

    return rows.map(toPlatformUpdate);
  }

  async get(id: string): Promise<PlatformUpdateDetails> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundException('Update not found');
    }

    return { ...toPlatformUpdate(row), log: row.log };
  }

  async start(
    payload: StartPlatformUpdatePayload,
    actor: string | null,
  ): Promise<PlatformUpdateDetails> {
    const target = normalizeVersion(
      typeof payload?.version === 'string' ? payload.version : null,
    );

    if (!target) {
      throw new BadRequestException(
        'version must be a release version such as 1.2.3',
      );
    }

    const current = await this.versions.currentVersion();
    const blocked = this.blockedReason(current);

    if (blocked || !current) {
      throw new BadRequestException(blocked ?? DEV_BUILD_MESSAGE);
    }

    if (await this.findActive()) {
      throw new ConflictException(UPDATE_IN_PROGRESS_MESSAGE);
    }

    const release = await this.releases.find(target);

    if (!release || compareVersions(release.version, current) <= 0) {
      throw new BadRequestException(UNKNOWN_RELEASE_MESSAGE);
    }

    const [checksums, image, nodeName] = await Promise.all([
      this.releases.checksums(release),
      this.versions.readApiImage(),
      this.versions.installationNode(),
    ]);

    if (!image) {
      throw new BadRequestException(
        'Could not read the API Deployment, which the update launcher runs from.',
      );
    }

    const id = crypto.randomUUID();
    const name = updateExternalName(id);
    let row: PlatformUpdateRow;

    try {
      [row] = await this.db
        .insert(platformUpdate)
        .values({
          id,
          from_version: current,
          to_version: release.version,
          external_name: name,
          actor,
          stage: 'launch',
        })
        .returning();
    } catch (error) {
      if (isActiveConflict(error)) {
        throw new ConflictException(UPDATE_IN_PROGRESS_MESSAGE);
      }

      throw error;
    }

    try {
      await this.kubernetes.batchV1.createNamespacedJob({
        namespace: this.versions.namespace,
        body: buildUpdateJob({
          id,
          name,
          namespace: this.versions.namespace,
          image,
          nodeName,
          targetVersion: release.version,
          releaseUrl: releaseDownloadBase(
            this.releases.repository,
            release.tag,
          ),
          updateSha256: checksums.updateSha256,
          installSha256: checksums.installSha256,
          configDir: this.configDir,
          updateRoot: this.updateRoot,
        }),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to start platform update ${name}: ${(error as Error).message}`,
      );
      await this.finish(row, {
        status: 'failed',
        message: 'The update launcher could not be created in the cluster.',
      });
      throw toNestException(error);
    }

    this.logger.log(
      `Platform update ${current} -> ${release.version} started by ${actor ?? 'unknown'}`,
    );

    const running = await this.patch(row, { status: 'running' });
    this.schedule(id);

    return { ...toPlatformUpdate(running ?? row), log: '' };
  }

  /**
   * One poll step: copies the reported progress into the row and finishes it
   * when the server reports an outcome or goes silent. Returns true when the
   * update needs no further polling.
   */
  async poll(id: string): Promise<boolean> {
    const row = await this.findById(id);

    if (!row || !ACTIVE_STATUSES.includes(row.status)) {
      return true;
    }

    let configMap: V1ConfigMap | null;

    try {
      configMap = await this.readConfigMap(row.external_name);
    } catch (error) {
      // The cluster is restarting (k3s update): keep the row and retry.
      this.logger.debug(
        `Update ${row.external_name}: status not readable (${(error as Error).message})`,
      );
      return this.giveUpIfSilent(row);
    }

    if (!configMap) {
      return this.checkLauncher(row);
    }

    const reported = parseReportedStatus(configMap.data?.status ?? '');
    const log = cleanLog(configMap.data?.log ?? '');
    const progress: RowPatch = {
      stage: reported.stage ?? row.stage,
      log,
      reported_at: reported.reportedAt ?? new Date(),
    };

    if (!isFinalPhase(reported.phase)) {
      await this.patch(row, progress);
      return this.giveUpIfSilent({ ...row, ...progress });
    }

    await this.finish(row, {
      ...progress,
      status: statusOfPhase(reported.phase),
      message: reported.message,
    });
    this.versions.invalidate();
    await this.deleteConfigMap(row.external_name);
    this.logger.log(
      `Platform update ${row.from_version} -> ${row.to_version}: ${reported.phase}`,
    );
    return true;
  }

  private blockedReason(current: string | null): string | null {
    if (process.env.PLATFORM_UPDATES_ENABLED === '0') {
      return UPDATES_DISABLED_MESSAGE;
    }

    if (!current) {
      return DEV_BUILD_MESSAGE;
    }

    if (!this.versions.inCluster) {
      return OUT_OF_CLUSTER_MESSAGE;
    }

    return null;
  }

  /** No status yet: the launcher is starting, or it failed. */
  private async checkLauncher(row: PlatformUpdateRow): Promise<boolean> {
    let job: V1Job | null = null;

    try {
      job = await this.kubernetes.batchV1.readNamespacedJob({
        name: row.external_name,
        namespace: this.versions.namespace,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        return this.giveUpIfNotStarted(row);
      }
    }

    if (job && jobOutcome(job) === 'failed') {
      const log = await this.readLauncherLog(row.external_name);
      await this.finish(row, {
        status: 'failed',
        stage: 'launch',
        message: launcherFailureMessage(log),
        log: cleanLog(log ?? ''),
      });
      return true;
    }

    return this.giveUpIfNotStarted(row);
  }

  private async giveUpIfNotStarted(row: PlatformUpdateRow): Promise<boolean> {
    if (Date.now() - row.started_at.getTime() < START_TIMEOUT_MS) {
      return false;
    }

    await this.finish(row, { status: 'failed', message: NOT_STARTED_MESSAGE });
    return true;
  }

  private async giveUpIfSilent(row: PlatformUpdateRow): Promise<boolean> {
    const last = row.reported_at ?? row.started_at;

    if (Date.now() - last.getTime() < SILENCE_TIMEOUT_MS) {
      return false;
    }

    await this.finish(row, { status: 'failed', message: SILENCE_MESSAGE });
    return true;
  }

  private async readConfigMap(name: string): Promise<V1ConfigMap | null> {
    try {
      return await this.kubernetes.coreV1.readNamespacedConfigMap({
        name,
        namespace: this.versions.namespace,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return null;
      }

      throw error;
    }
  }

  private async deleteConfigMap(name: string): Promise<void> {
    try {
      await this.kubernetes.coreV1.deleteNamespacedConfigMap({
        name,
        namespace: this.versions.namespace,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        this.logger.warn(
          `Failed to delete update status ${name}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async readLauncherLog(name: string): Promise<string | null> {
    try {
      const pods = await this.kubernetes.coreV1.listNamespacedPod({
        namespace: this.versions.namespace,
        labelSelector: `job-name=${name}`,
      });
      const pod = pods.items[0]?.metadata?.name;

      if (!pod) {
        return null;
      }

      return await this.kubernetes.coreV1.readNamespacedPodLog({
        name: pod,
        namespace: this.versions.namespace,
        container: LAUNCHER_CONTAINER,
      });
    } catch {
      return null;
    }
  }

  private async findById(id: string): Promise<PlatformUpdateRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformUpdate)
      .where(eq(platformUpdate.id, id))
      .limit(1);
    return row;
  }

  private async findActive(): Promise<PlatformUpdateRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformUpdate)
      .where(inArray(platformUpdate.status, ACTIVE_STATUSES))
      .limit(1);
    return row;
  }

  private async findLastFinished(): Promise<PlatformUpdateRow | undefined> {
    const [row] = await this.db
      .select()
      .from(platformUpdate)
      .where(
        inArray(platformUpdate.status, ['succeeded', 'failed', 'rolled_back']),
      )
      .orderBy(desc(platformUpdate.started_at))
      .limit(1);
    return row;
  }

  /** Writes progress to a row that is still active; a finished row stays. */
  private async patch(
    row: PlatformUpdateRow,
    values: RowPatch,
  ): Promise<PlatformUpdateRow | undefined> {
    const [updated] = await this.db
      .update(platformUpdate)
      .set(values)
      .where(
        and(
          eq(platformUpdate.id, row.id),
          inArray(platformUpdate.status, ACTIVE_STATUSES),
        ),
      )
      .returning();

    return updated;
  }

  private finish(
    row: PlatformUpdateRow,
    values: RowPatch & { status: PlatformUpdateStatus },
  ): Promise<PlatformUpdateRow | undefined> {
    const stage: PlatformUpdateStage | null | undefined =
      values.status === 'succeeded' ? 'done' : undefined;

    return this.patch(row, {
      ...values,
      ...(stage ? { stage } : {}),
      finished_at: new Date(),
    });
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
            `Platform update ${id} poll failed: ${(error as Error).message}`,
          );
          this.schedule(id);
        });
    }, POLL_INTERVAL_MS);

    timer.unref();
    this.timers.set(id, timer);
  }

  private async resumeActive(): Promise<void> {
    const rows = await this.db
      .select({ id: platformUpdate.id })
      .from(platformUpdate)
      .where(inArray(platformUpdate.status, ACTIVE_STATUSES));

    for (const { id } of rows) {
      this.schedule(id);
    }
  }
}
