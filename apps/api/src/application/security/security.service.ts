import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { V1Pod } from '@kubernetes/client-node';
import {
  ACCEPT_RISK_DAYS,
  type AcceptRiskPayload,
  type GithubWorkloadConfig,
  type ImageVulnerabilities,
  type ProjectSecurity,
  type SecurityRecommendation,
  type ServiceImageScan,
  type Vulnerability,
} from '@acceleratio/shared';
import { and, eq, gt, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { projectNamespace } from '@/common/naming';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { parseImageReference } from '@/vendor/registry/oci-registry.client';
import { ProjectService } from '../project/project.service';
import { project } from '../project/schemas/project.schema';
import {
  ALLOWED_CIDRS_ANNOTATION,
  externalServiceName,
} from '../workload/postgres/postgres.manifests';
import { workloadDomain } from '../workload/schemas/workload-domain.schema';
import { workloadVersion } from '../workload/schemas/workload-version.schema';
import { workload } from '../workload/schemas/workload.schema';
import { ImageScanService } from './image-scan.service';
import { ImageVersionService, versionKey } from './image-version.service';
import { parseTag } from './image-versions';
import { KevService } from './kev.service';
import { projectImages, type ProjectImage } from './project-images';
import {
  assessService,
  sortRecommendations,
  statusOf,
  type ServiceFacts,
} from './recommendations';
import {
  securityAcceptance,
  securityRecommendationSeen,
  type SecurityAcceptanceRow,
} from './schemas/security-recommendation.schema';

/** Every project's images are queued this often, so new deploys get scanned. */
const SWEEP_MS = 60 * 60 * 1000;
/** The first sweep waits for the API to settle after a start. */
const FIRST_SWEEP_MS = 60 * 1000;
const EVERYONE = new Set(['0.0.0.0/0', '::/0']);
/** A recommendation counts as new this long after it first appears… */
const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;
/** …unless it came with the project's first ones, within this window. */
const BASELINE_MS = 60 * 60 * 1000;
const MAX_REASON = 500;

/** More to fix than when the risk was accepted: it comes back. */
const grew = (
  item: SecurityRecommendation,
  accepted: SecurityAcceptanceRow,
): boolean =>
  (item.fixes?.critical ?? 0) > (accepted.fixes?.critical ?? 0) ||
  (item.fixes?.high ?? 0) > (accepted.fixes?.high ?? 0) ||
  item.exploited > accepted.exploited;

/**
 * The Security tab: which images the project's services run and what their
 * scans found. Reading it also queues images that were never scanned.
 */
@Injectable()
export class SecurityService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SecurityService.name);
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kubernetes: KubernetesService,
    private readonly projects: ProjectService,
    private readonly scans: ImageScanService,
    private readonly kev: KevService,
    private readonly versions: ImageVersionService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setTimeout(() => void this.sweep(), FIRST_SWEEP_MS);
  }

  onApplicationShutdown(): void {
    clearTimeout(this.timer);
  }

  async get(projectId: string): Promise<ProjectSecurity> {
    await this.projects.get(projectId);

    const [workloads, pods, exposed] = await Promise.all([
      this.workloads(projectId),
      this.pods(projectId),
      this.databaseNetworks(projectId),
    ]);
    const images = projectImages(pods, workloads);
    const rows = await this.scans.track(images);
    const byDigest = new Map(rows.map((row) => [row.digest, row]));
    const routed = await this.routed(workloads.map((item) => item.id));
    const releases = await this.releases(
      images.filter(
        (image) =>
          !image.managed &&
          workloads.find((item) => item.id === image.workload_id)?.type ===
            'docker',
      ),
    );

    const assessed = workloads.flatMap((item) => {
      const own = images.filter((image) => image.workload_id === item.id);
      const networks =
        item.type === 'postgres'
          ? (exposed.get(externalServiceName(item.external_name)) ?? [])
          : [];
      const openToEveryone = networks.some((cidr) => EVERYONE.has(cidr));

      if (own.length === 0 && !openToEveryone) {
        return [];
      }

      const facts: ServiceFacts = {
        workload_id: item.id,
        type: item.type,
        public: routed.has(item.id) || openToEveryone,
        builder:
          item.type !== 'github'
            ? null
            : (item.config as Partial<GithubWorkloadConfig> | null)
                  ?.built_commands === 'dockerfile'
              ? 'dockerfile'
              : 'railpack',
        open_to_everyone: openToEveryone,
        images: own.map((image) => {
          const row = byDigest.get(image.digest);

          return {
            image: image.image,
            managed: image.managed,
            release: releases.get(image.image),
            vulnerabilities:
              row?.counts && row.vulnerabilities
                ? this.markExploited(row.vulnerabilities)
                : null,
          };
        }),
      };

      return [assessService(facts)];
    });

    const all = assessed.flatMap((item) => item.recommendations);
    const firstSeen = await this.recordSeen(
      projectId,
      all,
      assessed
        .filter((item) => !item.scanned)
        .map((item) => item.service.workload_id),
    );
    const baseline = Math.min(...firstSeen.values());
    const now = Date.now();

    for (const item of all) {
      const seen = firstSeen.get(item.id) ?? now;
      item.is_new = seen > baseline + BASELINE_MS && now - seen < NEW_FOR_MS;
    }

    const acceptances = new Map(
      (
        await this.db
          .select()
          .from(securityAcceptance)
          .where(
            and(
              eq(securityAcceptance.project_id, projectId),
              gt(securityAcceptance.expires_at, sql`now()`),
            ),
          )
      ).map((row) => [row.recommendation_id, row]),
    );
    const accepted: ProjectSecurity['accepted'] = [];
    const open: SecurityRecommendation[] = [];

    for (const item of all) {
      const acceptance = acceptances.get(item.id);

      if (acceptance && !grew(item, acceptance)) {
        accepted.push({
          recommendation: item,
          reason: acceptance.reason,
          accepted_by: acceptance.accepted_by,
          accepted_at: acceptance.created_at.toISOString(),
          expires_at: acceptance.expires_at.toISOString(),
        });
      } else {
        // Grown since it was accepted: it is news again.
        item.is_new ||= acceptance !== undefined;
        open.push(item);
      }
    }

    return {
      images: images.map((image): ServiceImageScan => {
        const row = byDigest.get(image.digest);

        return {
          workload_id: image.workload_id,
          container: image.container,
          image: image.image,
          digest: image.digest,
          managed: image.managed,
          status: row?.status ?? 'pending',
          status_message: row?.status_message ?? null,
          scanned_at:
            row?.status === 'succeeded' && row.finished_at
              ? row.finished_at.toISOString()
              : null,
          counts: row?.counts ?? null,
          fixable: row?.fixable ?? null,
        };
      }),
      services: assessed.map(({ service, scanned }) => ({
        ...service,
        status: statusOf(
          open.filter((item) => item.workload_id === service.workload_id),
          service.platform_fixable,
          service.waiting,
          scanned,
        ),
      })),
      recommendations: sortRecommendations(open),
      accepted,
    };
  }

  /** Only for an image one of the project's services runs. */
  async vulnerabilities(
    projectId: string,
    digest: string,
  ): Promise<ImageVulnerabilities> {
    const images = await this.images(projectId);

    if (!images.some((image) => image.digest === digest)) {
      throw new NotFoundException('No service of this project runs that image');
    }

    const [row] = await this.scans.rows([digest]);
    const counts = row?.counts;

    return {
      digest,
      vulnerabilities: this.markExploited(row?.vulnerabilities ?? []),
      total: counts
        ? Object.values(counts).reduce((sum, count) => sum + count, 0)
        : 0,
    };
  }

  async rescan(projectId: string): Promise<ProjectSecurity> {
    const images = await this.images(projectId);

    await this.scans.track(images);
    await this.scans.rescan(images.map((image) => image.digest));

    return this.get(projectId);
  }

  /** Hides a recommendation until `days` pass or it grows. */
  async acceptRisk(
    projectId: string,
    payload: AcceptRiskPayload,
    acceptedBy: string | null,
  ): Promise<ProjectSecurity> {
    const reason =
      typeof payload?.reason === 'string' ? payload.reason.trim() : '';
    const days = payload?.days;

    if (!reason || reason.length > MAX_REASON) {
      throw new BadRequestException(
        `Say why the risk is acceptable, in at most ${MAX_REASON} characters`,
      );
    }

    if (!(ACCEPT_RISK_DAYS as readonly number[]).includes(days)) {
      throw new BadRequestException(
        `days must be one of ${ACCEPT_RISK_DAYS.join(', ')}`,
      );
    }

    const current = await this.get(projectId);
    const item = [
      ...current.recommendations,
      ...current.accepted.map((entry) => entry.recommendation),
    ].find((entry) => entry.id === payload.recommendation_id);

    if (!item) {
      throw new NotFoundException('No such recommendation in this project');
    }

    const values = {
      reason,
      accepted_by: acceptedBy,
      fixes: item.fixes,
      exploited: item.exploited,
      expires_at: sql`now() + make_interval(days => ${days})`,
      created_at: sql`now()`,
    };

    await this.db
      .insert(securityAcceptance)
      .values({
        recommendation_id: item.id,
        project_id: projectId,
        workload_id: item.workload_id,
        ...values,
      })
      .onConflictDoUpdate({
        target: securityAcceptance.recommendation_id,
        set: values,
      });

    return this.get(projectId);
  }

  /** Shows an accepted recommendation again. */
  async restoreRisk(
    projectId: string,
    recommendationId: string,
  ): Promise<ProjectSecurity> {
    await this.db
      .delete(securityAcceptance)
      .where(
        and(
          eq(securityAcceptance.project_id, projectId),
          eq(securityAcceptance.recommendation_id, recommendationId),
        ),
      );

    return this.get(projectId);
  }

  /**
   * The newest release of each image's line, as far as it is known. Images
   * not looked up for a day are looked up in the background; a found release
   * is kept in the scan queue.
   */
  private async releases(
    images: ProjectImage[],
  ): Promise<
    Map<string, NonNullable<ServiceFacts['images'][number]['release']>>
  > {
    const specs = [...new Set(images.map((image) => image.image))];
    const checks = await this.versions.rows(specs);

    this.versions.checkSoon(specs, checks);

    const candidates = [...checks.values()].flatMap((row) => {
      const reference = parseImageReference(row.image);

      return row.candidate_digest && reference
        ? [
            {
              digest: row.candidate_digest,
              image_id: `${reference.registry}/${reference.repository}@${row.candidate_digest}`,
            },
          ]
        : [];
    });
    const scanned = new Map(
      (await this.scans.track(candidates)).map((row) => [row.digest, row]),
    );
    const result = new Map<
      string,
      NonNullable<ServiceFacts['images'][number]['release']>
    >();

    for (const spec of specs) {
      const reference = parseImageReference(spec);

      if (!reference?.tag || !parseTag(reference.tag)) {
        continue;
      }

      const row = checks.get(versionKey(reference));

      if (!row || row.error) {
        result.set(spec, { status: 'unknown' });
      } else if (!row.candidate_tag || !row.candidate_digest) {
        result.set(spec, { status: 'none' });
      } else {
        const scan = scanned.get(row.candidate_digest);

        result.set(spec, {
          status: 'found',
          tag: row.candidate_tag,
          image: `${spec.slice(0, spec.lastIndexOf(':'))}:${row.candidate_tag}`,
          vulnerabilities:
            scan?.counts && scan.vulnerabilities
              ? this.markExploited(scan.vulnerabilities)
              : null,
        });
      }
    }

    return result;
  }

  private markExploited(items: Vulnerability[]): Vulnerability[] {
    return items.map((item) => ({
      ...item,
      exploited: this.kev.isExploited(item.id),
    }));
  }

  /**
   * When each current recommendation was first given. Ones that are gone are
   * forgotten, so a recommendation that comes back is new again; a service
   * with an image not scanned yet (a fresh deploy) keeps its own.
   */
  private async recordSeen(
    projectId: string,
    items: SecurityRecommendation[],
    unscanned: string[],
  ): Promise<Map<string, number>> {
    const ids = items.map((item) => item.id);

    if (ids.length > 0) {
      await this.db
        .insert(securityRecommendationSeen)
        .values(
          items.map((item) => ({
            recommendation_id: item.id,
            project_id: projectId,
            workload_id: item.workload_id,
          })),
        )
        .onConflictDoNothing();
    }

    await this.db
      .delete(securityRecommendationSeen)
      .where(
        and(
          eq(securityRecommendationSeen.project_id, projectId),
          ids.length > 0
            ? notInArray(securityRecommendationSeen.recommendation_id, ids)
            : undefined,
          unscanned.length > 0
            ? notInArray(securityRecommendationSeen.workload_id, unscanned)
            : undefined,
        ),
      );

    const rows = await this.db
      .select()
      .from(securityRecommendationSeen)
      .where(eq(securityRecommendationSeen.project_id, projectId));

    return new Map(
      rows.map((row) => [row.recommendation_id, row.first_seen_at.getTime()]),
    );
  }

  private async images(projectId: string): Promise<ProjectImage[]> {
    await this.projects.get(projectId);

    return projectImages(
      await this.pods(projectId),
      await this.workloads(projectId),
    );
  }

  /** The project's services with the config the cluster runs. */
  private workloads(projectId: string) {
    return this.db
      .select({
        id: workload.id,
        name: workload.name,
        type: workload.type,
        external_name: workload.external_name,
        config: workloadVersion.config,
      })
      .from(workload)
      .leftJoin(
        workloadVersion,
        eq(workload.active_version_id, workloadVersion.id),
      )
      .where(eq(workload.project_id, projectId));
  }

  /** Services with a domain that routes traffic to them. */
  private async routed(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }

    const rows = await this.db
      .selectDistinct({ id: workloadDomain.workload_id })
      .from(workloadDomain)
      .where(
        and(
          inArray(workloadDomain.workload_id, ids),
          eq(workloadDomain.routed, true),
        ),
      );

    return new Set(rows.map((row) => row.id));
  }

  /** The networks each open database port allows, by its Service name. */
  private async databaseNetworks(
    projectId: string,
  ): Promise<Map<string, string[]>> {
    try {
      const { items } = await this.kubernetes.coreV1.listNamespacedService({
        namespace: projectNamespace(projectId),
      });

      return new Map(
        items.map((service) => [
          service.metadata?.name ?? '',
          (service.metadata?.annotations?.[ALLOWED_CIDRS_ANNOTATION] ?? '')
            .split(',')
            .map((cidr) => cidr.trim())
            .filter(Boolean),
        ]),
      );
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return new Map();
      }

      throw error;
    }
  }

  private async pods(projectId: string): Promise<V1Pod[]> {
    try {
      const { items } = await this.kubernetes.coreV1.listNamespacedPod({
        namespace: projectNamespace(projectId),
      });

      return items;
    } catch (error) {
      // A project that never deployed has no namespace, and so no images.
      if (getKubernetesStatusCode(error) === 404) {
        return [];
      }

      this.logger.warn(
        `Failed to list pods of ${projectId}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Kubernetes API is unavailable');
    }
  }

  /** Queues the images of every project, then prunes unused scans. */
  private async sweep(): Promise<void> {
    try {
      const ids = await this.db.select({ id: project.id }).from(project);

      for (const { id } of ids) {
        try {
          const images = await this.images(id);

          await this.scans.track(images);
          // Built images are pinned by digest and have no tag to look up.
          const specs = images
            .filter((image) => !image.managed)
            .map((image) => image.image);
          this.versions.checkSoon(specs, await this.versions.rows(specs));
        } catch (error) {
          this.logger.warn(
            `Security sweep of ${id} failed: ${(error as Error).message}`,
          );
        }
      }

      await this.scans.prune();
      await this.versions.prune();
      await this.db
        .delete(securityAcceptance)
        .where(lt(securityAcceptance.expires_at, sql`now()`));
    } catch (error) {
      this.logger.warn(`Security sweep failed: ${(error as Error).message}`);
    } finally {
      this.timer = setTimeout(() => void this.sweep(), SWEEP_MS);
    }
  }
}
