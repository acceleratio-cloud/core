import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  DockerWorkloadConfig,
  StaticRelease,
  StaticWorkloadConfig,
  UpdateWorkloadPayload,
  Workload,
  WorkloadConfig,
  WorkloadDiffSection,
} from '@acceleratio/shared';
import { and, eq, sql } from 'drizzle-orm';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { ProjectService } from '@/application/project/project.service';
import { StorageClassService } from '@/application/storage-class/storage-class.service';
import { projectNamespace } from '@/common/naming';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { sitesBucket } from '@/vendor/s3/rustfs';
import { S3StorageClient } from '@/vendor/s3/s3.client';
import { DockerWorkloadNetworkService } from '../docker/docker-workload-network.service';
import { diffDockerConfigs } from '../docker/docker-workload.diff';
import type { WorkloadManifestInput } from '../docker/docker-workload.manifests';
import { DockerWorkloadService } from '../docker/docker-workload.service';
import { WorkloadEventsService } from '../observer/workload-events.service';
import { WorkloadStatusService } from '../observer/workload-status.service';
import { runBucketJob, rustfsTarget } from '../s3-bucket/rustfs-jobs';
import { normalizeObjectPath } from '../s3-bucket/s3-bucket.config';
import type { BucketJobInput } from '../s3-bucket/s3-bucket.manifests';
import { generateBucketKeys } from '../s3-bucket/s3-bucket.service';
import { workloadVersion } from '../schemas/workload-version.schema';
import { compareField, changesOf } from '../workload-version.diff';
import {
  WorkloadVersionService,
  type VersionAuthorInput,
} from '../workload-version.service';
import {
  isServedPath,
  normalizeStaticConfig,
  releaseIdOf,
  releaseOf,
} from './static-workload.config';
import {
  buildSiteFilesContainer,
  buildSiteKeySecret,
  releaseKeyPrefix,
  SITE_KEY_LABEL,
  SITE_MOUNT_PATH,
  siteKeySecretName,
  sitePrefix,
  siteServerArgs,
  SITE_READINESS_PROBE,
  STATIC_SERVER_IMAGE,
} from './static-workload.manifests';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
/** The key Job pulls the rc image on a site's first deploy. */
const KEY_JOB_WAIT_MS = 3 * 60 * 1000;

const releaseKey = (workloadId: string, releaseId: string): string =>
  `${workloadId}/${releaseId}`;
export const NO_FILES_MESSAGE = 'Upload the site files before deploying';
export const PUBLISHED_RELEASE_MESSAGE =
  'This upload is already published; start a new one to change the files';
export const MISSING_INDEX_MESSAGE = 'The upload has no index.html at its root';
export const UPLOAD_IN_PROGRESS_MESSAGE =
  'Files of this upload are still being sent; publish it once they finish';
export const PUBLISH_TO_CHANGE_FILES_MESSAGE =
  'Publish an upload to change the files the site serves';

/**
 * A site of uploaded files. It runs as a Docker service whose image is a
 * static file server, so domains, instances, logs, versions and rollback are
 * the Docker service's. Files go to the platform's sites bucket in RustFS
 * under `<workload>/<release>/`; each pod copies its version's release into
 * an emptyDir before the server starts, with the site's own read-only key,
 * so a deploy is a rolling update onto new files and a rollback serves the
 * old ones again. A pod starts slower the bigger the site.
 *
 * shortcut: releases are kept until the site is deleted, including uploads
 * never published; prune unreferenced ones if storage becomes a concern.
 */
@Injectable()
export class StaticWorkloadService extends DockerWorkloadService {
  override readonly type = 'static' as const;

  private readonly siteLogger = new Logger(StaticWorkloadService.name);
  /**
   * Releases by `<workload>/<release>`: uploads being written now, publishes
   * running now, how many publishes started, and releases the database
   * showed unpublished (so later files skip the query). The database stays
   * the record of what is published; these only close the gaps while a
   * publish or an upload awaits. Every check and update here is synchronous,
   * and the API runs as one instance per cluster.
   * shortcut: `open` and `publishes` grow by one key per upload until a
   * restart; fine for uploads a person makes, revisit if CI uploads every few
   * seconds.
   */
  private readonly writing = new Map<string, number>();
  private readonly publishing = new Set<string>();
  private readonly publishes = new Map<string, number>();
  private readonly open = new Set<string>();

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
    private readonly s3: S3StorageClient,
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

  /**
   * Settings replace the stored ones like a Docker service's. The files are
   * not a setting: the release stays as it is, and changing it takes
   * `publishRelease`.
   */
  override async update(
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ): Promise<Workload> {
    if (payload?.config === undefined) {
      return super.update(projectId, id, payload);
    }

    const row = await this.findRow(projectId, id);
    const current = releaseOf(
      row.draft_config ?? (await this.activeVersion(row))?.config,
    );
    const requested = (payload.config as StaticWorkloadConfig | null)
      ?.release_id;

    if (requested !== undefined && releaseIdOf(requested) !== current) {
      throw new BadRequestException(PUBLISH_TO_CHANGE_FILES_MESSAGE);
    }

    return super.update(projectId, id, {
      ...payload,
      config: {
        ...payload.config,
        release_id: current ?? undefined,
      },
    });
  }

  /**
   * Makes a release the files of the draft, keeping the settings the site has
   * now. It needs `index.html` at its root and no file of it still uploading;
   * once published, it takes no more files.
   */
  async publishRelease(
    projectId: string,
    id: string,
    releaseInput: unknown,
  ): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const releaseId = releaseIdOf(releaseInput);
    const key = releaseKey(row.id, releaseId);

    if (this.writing.has(key) || this.publishing.has(key)) {
      throw new ConflictException(UPLOAD_IN_PROGRESS_MESSAGE);
    }

    this.publishing.add(key);
    this.publishes.set(key, (this.publishes.get(key) ?? 0) + 1);
    this.open.delete(key);

    try {
      await this.requireIndex(row.id, releaseId);

      // Read now, not before the check: settings saved meanwhile stay.
      const fresh = await this.findRow(projectId, id);
      const settings =
        fresh.draft_config ?? (await this.activeVersion(fresh))?.config ?? {};

      return await super.update(projectId, id, {
        config: { ...settings, release_id: releaseId },
      });
    } finally {
      this.publishing.delete(key);
    }
  }

  override async deploy(
    projectId: string,
    id: string,
    author?: VersionAuthorInput | null,
  ): Promise<Workload> {
    const row = await this.findRow(projectId, id);
    const config =
      row.draft_config ?? (await this.activeVersion(row))?.config ?? null;

    if (releaseOf(config) === null) {
      throw new ConflictException(NO_FILES_MESSAGE);
    }

    return super.deploy(projectId, id, author);
  }

  /** Deletes the service, then the site's key and every release. */
  override async remove(projectId: string, id: string): Promise<void> {
    const row = await this.findRow(projectId, id);

    await super.remove(projectId, id);

    try {
      await this.ignoreNotFound(() =>
        this.kubernetes.coreV1.deleteNamespacedSecret({
          name: siteKeySecretName(row.id),
          namespace: projectNamespace(row.project_id),
        }),
      );

      const failure = await runBucketJob(
        this.kubernetes,
        this.keyJobInput(row, 'delete'),
        null,
        KEY_JOB_WAIT_MS,
      );

      if (failure !== null) {
        throw new Error(`the site key was not removed: ${failure}`);
      }

      await this.s3.deletePrefix(sitesBucket(), sitePrefix(row.id));
    } catch (error) {
      // The service is already gone; what is left is storage, not a site.
      this.siteLogger.warn(
        `Could not clean up the files of static site ${row.id}: ${(error as Error).message}`,
      );
    }
  }

  /** A new, empty release to upload files into. */
  async createRelease(projectId: string, id: string): Promise<StaticRelease> {
    await this.findRow(projectId, id);

    return { id: randomUUID() };
  }

  /**
   * Streams one file into a release. A release that the draft or any
   * version serves is immutable, so what a version shows is what it served.
   * A hidden file is accepted and dropped (see `isServedPath`).
   */
  async uploadFile(
    projectId: string,
    id: string,
    releaseInput: unknown,
    pathInput: unknown,
    body: Readable,
    contentType: string | undefined,
  ): Promise<void> {
    const row = await this.findRow(projectId, id);
    const releaseId = releaseIdOf(releaseInput);
    const path = normalizeObjectPath(pathInput, 'file');

    if (!isServedPath(path)) {
      body.resume();
      return;
    }

    const key = releaseKey(row.id, releaseId);

    if (this.publishing.has(key)) {
      throw new ConflictException(PUBLISHED_RELEASE_MESSAGE);
    }

    // The database is asked once per release, not once per file. A publish
    // that starts while it is asked may write the draft after the read, so it
    // counts as published too.
    if (!this.open.has(key)) {
      const seen = this.publishes.get(key) ?? 0;
      const { draft_config } = await this.findRow(projectId, id);
      const published =
        releaseOf(draft_config) === releaseId ||
        (await this.versionServes(row.id, releaseId));

      if (published || (this.publishes.get(key) ?? 0) !== seen) {
        throw new ConflictException(PUBLISHED_RELEASE_MESSAGE);
      }

      this.open.add(key);
    }

    this.writing.set(key, (this.writing.get(key) ?? 0) + 1);

    try {
      await this.s3.put(
        sitesBucket(),
        `${releaseKeyPrefix(row.id, releaseId)}${path}`,
        body,
        contentType?.trim() || DEFAULT_CONTENT_TYPE,
      );
    } finally {
      const left = (this.writing.get(key) ?? 1) - 1;

      if (left > 0) {
        this.writing.set(key, left);
      } else {
        this.writing.delete(key);
      }
    }
  }

  protected override normalizeConfig(
    config: WorkloadConfig | undefined,
  ): DockerWorkloadConfig {
    return normalizeStaticConfig(config);
  }

  /** The server serves the version's release, copied in by an init container. */
  protected override async prepareManifest(
    input: WorkloadManifestInput,
  ): Promise<WorkloadManifestInput> {
    const releaseId = releaseOf(input.config);

    if (releaseId === null) {
      throw new ConflictException(NO_FILES_MESSAGE);
    }

    await this.ensureSiteKey(input);

    const target = rustfsTarget();

    return {
      ...input,
      // The server is the platform's, not the version's: every apply runs the
      // current image and flags.
      config: {
        ...input.config,
        docker_image: STATIC_SERVER_IMAGE,
        command: siteServerArgs(releaseId),
      },
      readiness_probe: SITE_READINESS_PROBE,
      files: {
        mount_path: SITE_MOUNT_PATH,
        init: buildSiteFilesContainer({
          workloadId: input.id,
          releaseId,
          bucket: sitesBucket(),
          endpoint: target.endpoint,
          image: target.image,
        }),
      },
    };
  }

  protected override diffSections(
    base: DockerWorkloadConfig | null,
    target: DockerWorkloadConfig | null,
  ): WorkloadDiffSection[] {
    return [
      {
        key: 'files',
        label: 'Files',
        changes: changesOf([
          compareField({
            path: 'release_id',
            label: 'Upload',
            before: base && releaseOf(base),
            after: target && releaseOf(target),
            impact: base === null ? null : 'restart',
          }),
        ]),
      },
      ...diffDockerConfigs(base, target),
    ];
  }

  /**
   * The site's read-only key to its prefix of the sites bucket. It is made
   * on the first deploy and kept in the project namespace; the Secret is
   * written only once RustFS knows the key, so a failed attempt is retried by
   * the next deploy (which also removes the key of the failed attempt).
   */
  private async ensureSiteKey(input: WorkloadManifestInput): Promise<void> {
    try {
      const secret = await this.kubernetes.coreV1.readNamespacedSecret({
        name: siteKeySecretName(input.id),
        namespace: projectNamespace(input.project_id),
      });

      if (secret.metadata?.labels?.[SITE_KEY_LABEL] === input.id) {
        return;
      }
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }
    }

    const keys = generateBucketKeys();
    const failure = await runBucketJob(
      this.kubernetes,
      this.keyJobInput(input, 'create'),
      keys,
      KEY_JOB_WAIT_MS,
    );

    if (failure !== null) {
      throw new ServiceUnavailableException(
        `Could not create the site's access key: ${failure}`,
      );
    }

    await this.kubernetes.coreV1.createNamespacedSecret({
      namespace: projectNamespace(input.project_id),
      body: buildSiteKeySecret(input, keys),
    });
  }

  private keyJobInput(
    site: Pick<WorkloadManifestInput, 'id' | 'project_id'>,
    operation: 'create' | 'delete',
  ): BucketJobInput {
    return {
      workloadId: site.id,
      projectId: site.project_id,
      bucket: sitesBucket(),
      prefix: sitePrefix(site.id),
      operation,
      target: rustfsTarget(),
    };
  }

  private async versionServes(
    workloadId: string,
    releaseId: string,
  ): Promise<boolean> {
    const [found] = await this.db
      .select({ id: workloadVersion.id })
      .from(workloadVersion)
      .where(
        and(
          eq(workloadVersion.workload_id, workloadId),
          sql`${workloadVersion.config}->>'release_id' = ${releaseId}`,
        ),
      )
      .limit(1);

    return found !== undefined;
  }

  private async requireIndex(
    workloadId: string,
    releaseId: string,
  ): Promise<void> {
    const index = await this.s3.head(
      sitesBucket(),
      `${releaseKeyPrefix(workloadId, releaseId)}index.html`,
    );

    if (index === null) {
      throw new BadRequestException(MISSING_INDEX_MESSAGE);
    }
  }

  private async ignoreNotFound(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (getKubernetesStatusCode(error) !== 404) {
        throw error;
      }
    }
  }
}
