import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { V1Job } from '@kubernetes/client-node';
import type {
  CreateWorkloadPayload,
  DockerWorkloadConfig,
  GithubWorkloadConfig,
  UpdateWorkloadPayload,
  Workload,
  WorkloadBuild,
  WorkloadBuildLog,
  WorkloadConfig,
} from '@acceleratio/shared';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { GithubService } from '@/application/integration/github/github.service';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import { StorageClassService } from '@/application/storage-class/storage-class.service';
import { REGISTRY_PULL_HOST } from '@/common/registry';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { jobOutcome } from '@/vendor/kubernetes/job-outcome';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { DockerWorkloadNetworkService } from '../docker/docker-workload-network.service';
import { normalizeDockerConfig } from '../docker/docker-workload.config';
import { DockerWorkloadService } from '../docker/docker-workload.service';
import { WorkloadEventsService } from '../observer/workload-events.service';
import { WorkloadStatusService } from '../observer/workload-status.service';
import {
  workloadBuild,
  type WorkloadBuildRow,
} from '../schemas/workload-build.schema';
import { workload } from '../schemas/workload.schema';
import {
  WorkloadVersionService,
  type VersionAuthorInput,
} from '../workload-version.service';
import {
  BUILD_CONTAINER,
  BUILD_DEADLINE_SECONDS,
  buildBuildNamespace,
  buildJob,
  buildJobName,
  buildNamespace,
  buildPolicy,
  buildSecret,
  imageRepository,
} from './github-build.manifests';

const POLL_INTERVAL_MS = 3000;
/** Past the Job deadline the build is failed even if the Job never reported. */
const GIVE_UP_MS = (BUILD_DEADLINE_SECONDS + 300) * 1000;
/** The end of the builder output kept in the database. */
const STORED_LOG_BYTES = 64 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const BUSY_MESSAGE = 'A build of this service is already running';
const SOURCE_KEYS = [
  'github_app_id',
  'repository',
  'branch',
  'docker_image',
  'commit_sha',
] as const;

/** The fields of a GitHub `push` delivery this service reads. */
export interface GithubPushPayload {
  ref?: string;
  deleted?: boolean;
  repository?: { full_name?: string };
  sender?: { login?: string };
  pusher?: { name?: string; email?: string | null };
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * The fields the API owns: the App and repository are fixed, the branch
 * changes only through `update`, the image comes from builds.
 */
const sourceOf = (config: WorkloadConfig | null | undefined) => {
  const source: Partial<GithubWorkloadConfig> = {};

  for (const key of SOURCE_KEYS) {
    const value = (config as Partial<GithubWorkloadConfig> | null)?.[key];

    if (value) {
      source[key] = value;
    }
  }

  return source;
};

const tail = (log: string): string =>
  log.length > STORED_LOG_BYTES ? log.slice(-STORED_LOG_BYTES) : log;

/** The last line BuildKit printed with an error, for the build's message. */
const failureLine = (log: string | null): string | null =>
  log
    ?.split('\n')
    .reverse()
    .find((line) => /error/i.test(line))
    ?.trim()
    .slice(0, 500) ?? null;

const toBuild = (row: WorkloadBuildRow): WorkloadBuild => ({
  id: row.id,
  workload_id: row.workload_id,
  commit_sha: row.commit_sha,
  commit_message: row.commit_message,
  status: row.status,
  status_message: row.status_message,
  author: row.author
    ? { ...row.author, github_login: row.author.github_login ?? null }
    : null,
  image: row.image,
  created_at: row.created_at.toISOString(),
  finished_at: row.finished_at?.toISOString() ?? null,
});

/** GitHub logins: letters, digits and single inner hyphens, up to 39. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * The GitHub account that pushed, recorded as the author of what the push
 * deploys. It has no account here, so it has no `id`; the console links to
 * its profile instead of showing an avatar.
 */
export const pushAuthor = (
  payload: GithubPushPayload,
): VersionAuthorInput | null => {
  const login = payload.sender?.login;

  if (!login || !GITHUB_LOGIN.test(login)) {
    return null;
  }

  return {
    id: null,
    name: login,
    // GitHub omits the email of accounts that keep it private.
    email: payload.pusher?.email || `${login}@users.noreply.github.com`,
    github_login: login,
  };
};

/**
 * GitHub services: Docker services whose image is built from a repository
 * branch. Everything after the image (versions, env, volumes, domains,
 * status) is the Docker service's; this class adds the source fields to the
 * config and turns a deploy into a build.
 *
 * A deploy resolves the branch head. When the current image was built from
 * it, the Docker deploy runs at once; otherwise a BuildKit Job builds and
 * pushes the commit, and the poll that sees it succeed records the image in
 * the draft and deploys it. Builds are polled from this process and resumed
 * after a restart.
 */
@Injectable()
export class GithubWorkloadService extends DockerWorkloadService {
  override readonly type = 'github' as const;

  private readonly buildLogger = new Logger(GithubWorkloadService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(DATABASE) db: Database,
    projectService: ProjectService,
    isolation: ProjectIsolationService,
    kubernetes: KubernetesService,
    status: WorkloadStatusService,
    events: WorkloadEventsService,
    versions: WorkloadVersionService,
    network: DockerWorkloadNetworkService,
    storageClasses: StorageClassService,
    private readonly github: GithubService,
  ) {
    super(
      db,
      projectService,
      isolation,
      kubernetes,
      status,
      events,
      versions,
      network,
      storageClasses,
    );
  }

  override onApplicationBootstrap(): void {
    super.onApplicationBootstrap();
    void this.resumeBuilds().catch((error: unknown) =>
      this.buildLogger.warn(
        `Failed to resume builds: ${(error as Error).message}`,
      ),
    );
  }

  override onApplicationShutdown(): void {
    super.onApplicationShutdown();

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
  }

  override async list(projectId: string): Promise<Workload[]> {
    const items = await super.list(projectId);
    const latest = await this.latestBuilds(items.map((item) => item.id));

    return items.map((item) => this.withBuild(item, latest.get(item.id)));
  }

  override async get(projectId: string, id: string): Promise<Workload> {
    const item = await super.get(projectId, id);
    const latest = await this.latestBuilds([id]);

    return this.withBuild(item, latest.get(id));
  }

  /** The repository must be reachable through the chosen App's installations. */
  override async create(
    projectId: string,
    payload: CreateWorkloadPayload,
  ): Promise<Workload> {
    if (payload?.type !== this.type) {
      throw new BadRequestException('Unsupported workload type');
    }

    const input = payload.config as Partial<GithubWorkloadConfig> | undefined;
    const appId = text(input?.github_app_id);
    const repository = text(input?.repository);

    if (!appId || !repository) {
      throw new BadRequestException('Choose a GitHub App and a repository');
    }

    const found = (await this.github.repositories(appId)).find(
      (item) => item.full_name === repository,
    );

    if (!found) {
      throw new BadRequestException(
        'The repository is not available to this GitHub App',
      );
    }

    const branch = text(input?.branch) || found.default_branch;

    await this.requireBranch(appId, found.full_name, branch);

    return super.create(projectId, {
      ...payload,
      config: {
        ...input,
        // Only builds set these.
        docker_image: undefined,
        commit_sha: undefined,
        github_app_id: appId,
        repository: found.full_name,
        branch,
      },
    });
  }

  /**
   * Settings change like a Docker service's, and so does the branch: the next
   * deploy builds its head. The App, repository and image cannot change.
   */
  override async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    const row = await this.findRow(projectId, id);

    if (payload?.auto_deploy !== undefined) {
      if (typeof payload.auto_deploy !== 'boolean') {
        throw new BadRequestException('auto_deploy must be true or false');
      }

      await this.db
        .update(workload)
        .set({ auto_deploy: payload.auto_deploy })
        .where(eq(workload.id, row.id));
    }

    if (payload?.config === undefined) {
      return this.withLatest(await super.update(projectId, id, payload));
    }

    const current =
      row.draft_config ?? (await this.activeVersion(row))?.config ?? null;
    const source = sourceOf(current);
    const branch = text(
      (payload.config as Partial<GithubWorkloadConfig>).branch,
    );

    if (branch && branch !== source.branch) {
      await this.requireBranch(
        source.github_app_id!,
        source.repository!,
        branch,
      );
      source.branch = branch;
    }

    return this.withLatest(
      await super.update(projectId, id, {
        ...payload,
        config: {
          ...payload.config,
          docker_image: undefined,
          commit_sha: undefined,
          ...source,
        } as WorkloadConfig,
      }),
    );
  }

  /**
   * Builds the branch head unless the current image already comes from it,
   * then deploys. Returns as soon as the build is started.
   */
  override async deploy(
    projectId: string,
    id: string,
    author?: VersionAuthorInput | null,
  ): Promise<Workload> {
    const { id: workloadId } = await this.findRow(projectId, id);
    const started = await this.exclusive(workloadId, () =>
      this.startBuild(projectId, id, author ?? null),
    );

    if (!started) {
      return this.withLatest(await super.deploy(projectId, id, author));
    }

    return this.get(projectId, id);
  }

  async listBuilds(projectId: string, id: string): Promise<WorkloadBuild[]> {
    await this.findRow(projectId, id);
    const rows = await this.db
      .select()
      .from(workloadBuild)
      .where(eq(workloadBuild.workload_id, id))
      .orderBy(desc(workloadBuild.created_at))
      .limit(20);

    return rows.map(toBuild);
  }

  /** Stops a running build; the service keeps running what it ran. */
  async cancelBuild(
    projectId: string,
    id: string,
    buildId: string,
  ): Promise<WorkloadBuild> {
    const row = await this.findRow(projectId, id);
    const [build] = await this.db
      .select()
      .from(workloadBuild)
      .where(
        and(eq(workloadBuild.id, buildId), eq(workloadBuild.workload_id, id)),
      )
      .limit(1);

    if (!build) {
      throw new NotFoundException('Build not found');
    }

    if (build.status !== 'building') {
      throw new ConflictException('The build has already finished');
    }

    await this.stopBuild(row.project_id, build, 'Cancelled');
    const [cancelled] = await this.db
      .select()
      .from(workloadBuild)
      .where(eq(workloadBuild.id, buildId))
      .limit(1);

    return toBuild(cancelled ?? build);
  }

  /**
   * A push to GitHub: deploys every service that follows the pushed branch
   * through this App, was deployed before and has auto-deploy on. A build
   * still running for an older commit is cancelled first. Errors are logged,
   * never returned to GitHub.
   */
  async handlePush(appId: string, payload: GithubPushPayload): Promise<void> {
    const branch = payload.ref?.startsWith('refs/heads/')
      ? payload.ref.slice('refs/heads/'.length)
      : null;
    const repository = payload.repository?.full_name;

    // Tags and deleted branches build nothing.
    if (!branch || !repository || payload.deleted) {
      return;
    }

    const rows = await this.db
      .select()
      .from(workload)
      .where(
        and(
          eq(workload.type, this.type),
          eq(workload.auto_deploy, true),
          isNotNull(workload.active_version_id),
        ),
      );

    for (const row of rows) {
      const config = (row.draft_config ??
        (await this.activeVersion(row))?.config) as
        GithubWorkloadConfig | undefined;

      if (
        config?.github_app_id !== appId ||
        config.repository !== repository ||
        config.branch !== branch
      ) {
        continue;
      }

      try {
        const running = await this.runningBuildRow(row.id);

        if (running) {
          await this.stopBuild(
            row.project_id,
            running,
            'Superseded by a newer push',
          );
        }

        await this.deploy(row.project_id, row.id, pushAuthor(payload));
      } catch (error) {
        this.buildLogger.warn(
          `Push to ${repository}@${branch} did not deploy ${row.name}: ${(error as Error).message}`,
        );
      }
    }
  }

  /** The stored log of a finished build, else what the builder printed so far. */
  async buildLog(
    projectId: string,
    id: string,
    buildId: string,
  ): Promise<WorkloadBuildLog> {
    await this.findRow(projectId, id);
    const [row] = await this.db
      .select()
      .from(workloadBuild)
      .where(
        and(eq(workloadBuild.id, buildId), eq(workloadBuild.workload_id, id)),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Build not found');
    }

    if (row.log !== null) {
      return { log: row.log };
    }

    return { log: (await this.readPod(row.external_name)).log ?? '' };
  }

  protected override normalizeConfig(
    config: WorkloadConfig | undefined,
  ): DockerWorkloadConfig {
    const input = config as Partial<GithubWorkloadConfig> | undefined;
    const source = {
      github_app_id: text(input?.github_app_id),
      repository: text(input?.repository),
      branch: text(input?.branch),
    };

    if (!source.github_app_id || !source.repository || !source.branch) {
      throw new BadRequestException('Choose a GitHub App and a repository');
    }

    const image = text(input?.docker_image);
    const commit = text(input?.commit_sha);
    // The Docker rules validate every other field; a service that was never
    // built has no image yet.
    const settings: Partial<DockerWorkloadConfig> = normalizeDockerConfig({
      ...input,
      docker_image: image || 'unbuilt',
    });

    delete settings.docker_image;
    // The built image decides how it starts: a Dockerfile's ENTRYPOINT and
    // CMD, or Railpack's start command. Older configs may still carry these.
    delete settings.entrypoint;
    delete settings.command;

    return {
      ...settings,
      ...source,
      ...(image ? { docker_image: image } : {}),
      ...(commit ? { commit_sha: commit } : {}),
    } as DockerWorkloadConfig;
  }

  private async requireBranch(
    appId: string,
    repository: string,
    branch: string,
  ): Promise<void> {
    if (!(await this.github.branches(appId, repository)).includes(branch)) {
      throw new BadRequestException(
        `Branch ${branch} does not exist in ${repository}`,
      );
    }
  }

  /** Starts a build, or returns false when the current image is up to date. */
  private async startBuild(
    projectId: string,
    id: string,
    author: VersionAuthorInput | null,
  ): Promise<boolean> {
    const row = await this.findRow(projectId, id);

    if (await this.runningBuild(row.id)) {
      throw new ConflictException(BUSY_MESSAGE);
    }

    const config = (row.draft_config ??
      (await this.activeVersion(row))?.config) as GithubWorkloadConfig;
    const head = await this.github.checkout(
      config.github_app_id,
      config.repository,
      config.branch,
    );

    if (config.docker_image && config.commit_sha === head.sha) {
      return false;
    }

    const buildId = randomUUID();
    const input = {
      buildId,
      workloadId: row.id,
      name: buildJobName(buildId),
      namespace: buildNamespace(),
      repository: config.repository,
      commitSha: head.sha,
      imageRepository: imageRepository(row.project_id, row.id),
    };
    const [build] = await this.db
      .insert(workloadBuild)
      .values({
        id: buildId,
        workload_id: row.id,
        commit_sha: head.sha,
        commit_message: head.message.split('\n')[0].slice(0, 500),
        external_name: input.name,
        author,
      })
      .returning();

    try {
      await this.ensureBuildNamespace(input.namespace);
      const job = await this.kubernetes.batchV1.createNamespacedJob({
        namespace: input.namespace,
        body: buildJob(input),
      });
      await this.kubernetes.coreV1.createNamespacedSecret({
        namespace: input.namespace,
        body: buildSecret(input, job, head.token),
      });
    } catch (error) {
      this.buildLogger.warn(
        `Failed to start build ${input.name}: ${(error as Error).message}`,
      );
      await this.finishBuild(build, {
        status: 'failed',
        status_message: 'The build could not be started in the cluster',
      });
      throw toNestException(error);
    }

    await this.announce(row.project_id, row.id);
    this.schedule(buildId);

    return true;
  }

  /**
   * One poll step. Returns true when the build reached a final state (or no
   * longer exists) and needs no further polling.
   */
  async pollBuild(buildId: string): Promise<boolean> {
    const [build] = await this.db
      .select()
      .from(workloadBuild)
      .where(eq(workloadBuild.id, buildId))
      .limit(1);

    if (!build || build.status !== 'building') {
      return true;
    }

    let job: V1Job | null;

    try {
      job = await this.kubernetes.batchV1.readNamespacedJob({
        name: build.external_name,
        namespace: buildNamespace(),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        // Cluster hiccup: keep polling until the give-up deadline.
        return this.giveUpIfStale(build);
      }

      job = null;
    }

    if (!job) {
      await this.finishBuild(build, {
        status: 'failed',
        status_message: 'The build Job is gone from the cluster',
      });
      return true;
    }

    const outcome = jobOutcome(job);

    if (outcome === 'running') {
      return this.giveUpIfStale(build);
    }

    const pod = await this.readPod(build.external_name);
    const log = pod.log === null ? null : tail(pod.log);

    if (outcome === 'succeeded' && pod.digest && DIGEST.test(pod.digest)) {
      const [owner] = await this.db
        .select({ project_id: workload.project_id })
        .from(workload)
        .where(eq(workload.id, build.workload_id))
        .limit(1);
      const image = `${REGISTRY_PULL_HOST}/${imageRepository(owner?.project_id ?? '', build.workload_id)}@${pod.digest}`;

      const won = await this.finishBuild(build, {
        status: 'succeeded',
        image,
        log,
      });

      // A cancelled build is not deployed, even when it got this far.
      if (won && owner) {
        await this.deployImage(owner.project_id, build, image);
      }

      return true;
    }

    const deadline = job.status?.conditions?.some(
      (condition) => condition.reason === 'DeadlineExceeded',
    );

    await this.finishBuild(build, {
      status: 'failed',
      status_message: deadline
        ? `The build ran longer than ${BUILD_DEADLINE_SECONDS / 60} minutes`
        : (failureLine(log) ?? 'The build failed; see its log'),
      log,
    });

    return true;
  }

  /** Records the built image as the draft's and deploys it as its author. */
  private async deployImage(
    projectId: string,
    build: WorkloadBuildRow,
    image: string,
  ): Promise<void> {
    try {
      await this.exclusive(build.workload_id, async () => {
        const row = await this.findRow(projectId, build.workload_id);
        const current =
          row.draft_config ?? (await this.activeVersion(row))?.config;
        const draft = this.normalizeConfig({
          ...current,
          docker_image: image,
          commit_sha: build.commit_sha,
        });

        await this.db
          .update(workload)
          .set({ draft_config: draft })
          .where(eq(workload.id, row.id));
      });
      await super.deploy(projectId, build.workload_id, build.author);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return;
      }

      this.buildLogger.warn(
        `Build ${build.external_name} succeeded but its deploy failed: ${(error as Error).message}`,
      );
    }
  }

  private async finishBuild(
    build: WorkloadBuildRow,
    result: Partial<
      Pick<WorkloadBuildRow, 'status' | 'status_message' | 'image' | 'log'>
    >,
  ): Promise<boolean> {
    const [finished] = await this.db
      .update(workloadBuild)
      .set({ ...result, finished_at: new Date() })
      // A cancel and a poll can race; the first to finish the build wins.
      .where(
        and(
          eq(workloadBuild.id, build.id),
          eq(workloadBuild.status, 'building'),
        ),
      )
      .returning();
    const [owner] = await this.db
      .select({ project_id: workload.project_id })
      .from(workload)
      .where(eq(workload.id, build.workload_id))
      .limit(1);

    if (finished && owner && finished.status === 'failed') {
      await this.announce(owner.project_id, build.workload_id);
    }

    return finished !== undefined;
  }

  private async giveUpIfStale(build: WorkloadBuildRow): Promise<boolean> {
    if (Date.now() - build.created_at.getTime() < GIVE_UP_MS) {
      return false;
    }

    await this.finishBuild(build, {
      status: 'failed',
      status_message: 'The build timed out',
    });
    return true;
  }

  /** Live canvases learn about a build through the status event stream. */
  /**
   * Live canvases learn about a build through the status event stream. A
   * build change bumps the row's `updated_at`, because the console keeps the
   * newest copy of a service and would otherwise drop later updates.
   */
  private async announce(projectId: string, workloadId: string): Promise<void> {
    await this.db
      .update(workload)
      .set({
        updated_at: sql`greatest(now()::timestamp, ${workload.updated_at} + interval '1 microsecond')`,
      })
      .where(eq(workload.id, workloadId));

    const view = await this.get(projectId, workloadId);

    this.events.publish({
      type: 'status',
      workload_id: workloadId,
      project_id: projectId,
      status: view.status,
      status_message: view.status_message,
      status_observed_at: view.status_observed_at,
      updated_at: view.updated_at,
    });
  }

  private withBuild(item: Workload, build?: WorkloadBuildRow): Workload {
    if (!build) {
      return item;
    }

    // A failed build is news only until the next deploy.
    if (
      build.status === 'failed' &&
      item.last_deployed_at !== null &&
      Date.parse(item.last_deployed_at) > build.created_at.getTime()
    ) {
      return item;
    }

    const status = buildStatus(build);

    return status ? { ...item, ...status } : item;
  }

  private async withLatest(item: Workload): Promise<Workload> {
    const latest = await this.latestBuilds([item.id]);

    return this.withBuild(item, latest.get(item.id));
  }

  private async latestBuilds(
    workloadIds: string[],
  ): Promise<Map<string, WorkloadBuildRow>> {
    if (workloadIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectDistinctOn([workloadBuild.workload_id])
      .from(workloadBuild)
      .where(inArray(workloadBuild.workload_id, workloadIds))
      .orderBy(workloadBuild.workload_id, desc(workloadBuild.created_at));

    return new Map(rows.map((row) => [row.workload_id, row]));
  }

  private async runningBuild(workloadId: string): Promise<boolean> {
    return (await this.runningBuildRow(workloadId)) !== undefined;
  }

  private async runningBuildRow(
    workloadId: string,
  ): Promise<WorkloadBuildRow | undefined> {
    const [row] = await this.db
      .select()
      .from(workloadBuild)
      .where(
        and(
          eq(workloadBuild.workload_id, workloadId),
          eq(workloadBuild.status, 'building'),
        ),
      )
      .limit(1);

    return row;
  }

  /** Marks a build cancelled, then deletes its Job, pod and token. */
  private async stopBuild(
    projectId: string,
    build: WorkloadBuildRow,
    reason: string,
  ): Promise<void> {
    clearTimeout(this.timers.get(build.id));
    this.timers.delete(build.id);
    const pod = await this.readPod(build.external_name);
    await this.finishBuild(build, {
      status: 'cancelled',
      status_message: reason,
      log: pod.log === null ? null : tail(pod.log),
    });

    try {
      await this.kubernetes.batchV1.deleteNamespacedJob({
        name: build.external_name,
        namespace: buildNamespace(),
        propagationPolicy: 'Background',
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        this.buildLogger.warn(
          `Failed to delete build Job ${build.external_name}: ${(error as Error).message}`,
        );
      }
    }

    // The service shows what the cluster runs again.
    await this.announce(projectId, build.workload_id);
  }

  private async resumeBuilds(): Promise<void> {
    const rows = await this.db
      .select({ id: workloadBuild.id })
      .from(workloadBuild)
      .where(eq(workloadBuild.status, 'building'));

    for (const { id } of rows) {
      this.schedule(id);
    }
  }

  private schedule(buildId: string): void {
    clearTimeout(this.timers.get(buildId));

    const timer = setTimeout(() => {
      this.timers.delete(buildId);
      this.pollBuild(buildId)
        .then((done) => {
          if (!done) {
            this.schedule(buildId);
          }
        })
        .catch((error: unknown) => {
          this.buildLogger.warn(
            `Build ${buildId} poll failed: ${(error as Error).message}`,
          );
          this.schedule(buildId);
        });
    }, POLL_INTERVAL_MS);

    this.timers.set(buildId, timer);
  }

  /** The builder's output and the digest it wrote to its termination message. */
  private async readPod(
    jobName: string,
  ): Promise<{ log: string | null; digest: string | null }> {
    const namespace = buildNamespace();

    try {
      const pods = await this.kubernetes.coreV1.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      const pod = pods.items[0];

      if (!pod?.metadata?.name) {
        return { log: null, digest: null };
      }

      const digest =
        pod.status?.containerStatuses
          ?.find((status) => status.name === BUILD_CONTAINER)
          ?.state?.terminated?.message?.trim() ?? null;
      const log = await this.kubernetes.coreV1.readNamespacedPodLog({
        name: pod.metadata.name,
        namespace,
        container: BUILD_CONTAINER,
      });

      return { log, digest };
    } catch (error) {
      // 400 while the container is still being created: no log yet.
      if (getKubernetesStatusCode(error) !== 400) {
        this.buildLogger.warn(
          `Failed to read build log ${jobName}: ${(error as Error).message}`,
        );
      }

      return { log: null, digest: null };
    }
  }

  /** The builds namespace and its network policy, created on first use. */
  private async ensureBuildNamespace(namespace: string): Promise<void> {
    try {
      await this.kubernetes.coreV1.createNamespace({
        body: buildBuildNamespace(namespace),
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }
    }

    const body = buildPolicy(namespace);

    try {
      await this.kubernetes.customObjects.createNamespacedCustomObject({
        group: 'cilium.io',
        version: 'v2',
        namespace,
        plural: 'ciliumnetworkpolicies',
        body,
      });
    } catch (error) {
      // shortcut: an existing policy is kept as is; after changing
      // BUILD_REGISTRY delete it so the next build recreates it.
      if (getKubernetesStatusCode(error) !== 409) {
        throw error;
      }
    }
  }
}

/** How a build shows on its service, or null once it no longer matters. */
const buildStatus = (
  build: WorkloadBuildRow,
): Pick<Workload, 'status' | 'status_message'> | null => {
  if (build.status === 'building') {
    return {
      status: 'deploying',
      status_message: `Building ${build.commit_sha.slice(0, 7)}`,
    };
  }

  if (build.status === 'failed') {
    return {
      status: 'failed',
      status_message: `Build of ${build.commit_sha.slice(0, 7)} failed: ${build.status_message ?? 'see its log'}`,
    };
  }

  return null;
};
