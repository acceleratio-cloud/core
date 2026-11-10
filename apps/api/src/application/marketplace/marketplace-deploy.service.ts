import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  DeployMarketplaceAppPayload,
  DockerWorkloadConfig,
  MarketplaceDeployment,
  Workload,
} from '@acceleratio/shared';
import { eq } from 'drizzle-orm';
import { ProjectService } from '@/application/project/project.service';
import { ControlPlaneDnsService } from '@/application/system/control-plane-dns.service';
import {
  DockerWorkloadNetworkService,
  PUBLIC_IP_UNKNOWN_MESSAGE,
} from '@/application/workload/docker/docker-workload-network.service';
import { workload } from '@/application/workload/schemas/workload.schema';
import { WorkloadService } from '@/application/workload/workload.service';
import type { VersionAuthorInput } from '@/application/workload/workload-version.service';
import { NAME_MAX_LENGTH, normalizeName } from '@/common/validation';
import { DATABASE, type Database } from '@/vendor/db/database.constants';

import type { MarketplaceTemplate } from './marketplace-template';
import { readInputs, render, type RenderContext } from './marketplace-values';
import { MarketplaceService } from './marketplace.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Turns a template into Docker services of one project: creates them, gives
 * the public one a generated domain, fills the env placeholders and deploys.
 * A failure removes what this deploy created, the project too when it was new.
 */
@Injectable()
export class MarketplaceDeployService {
  private readonly logger = new Logger(MarketplaceDeployService.name);
  /** The deploy running in each project; the next one waits for it. */
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly marketplace: MarketplaceService,
    private readonly projects: ProjectService,
    private readonly workloads: WorkloadService,
    private readonly network: DockerWorkloadNetworkService,
    private readonly dns: ControlPlaneDnsService,
  ) {}

  async deploy(
    slug: string,
    payload: DeployMarketplaceAppPayload,
    author: VersionAuthorInput | null,
  ): Promise<MarketplaceDeployment> {
    const template = this.marketplace.find(slug);
    if (!template) throw new NotFoundException('App not found');

    const name = normalizeName(payload?.name);
    const inputs = readInputs(template, payload?.inputs);
    const names = template.services.map((service, index) => {
      const full = index === 0 ? name : `${name}-${service.name}`;
      if (full.length > NAME_MAX_LENGTH) {
        throw new BadRequestException(
          `The ${service.name} service would be named "${full}", over ${NAME_MAX_LENGTH} characters; choose a shorter name`,
        );
      }
      return full;
    });
    const existingId = await this.existingProject(payload);

    // Checked before anything is created, so a failure leaves nothing to undo.
    if (
      template.services.some((service) => service.public) &&
      !(await this.dns.expectedIp())
    ) {
      throw new ConflictException(PUBLIC_IP_UNKNOWN_MESSAGE);
    }
    if (existingId) {
      return this.serialized(existingId, async () => {
        await this.assertNamesFree(existingId, names);
        return this.install(template, existingId, false, names, inputs, author);
      });
    }

    const { id } = await this.projects.create({ name: payload.project_name! });
    return this.install(template, id, true, names, inputs, author);
  }

  /**
   * shortcut: an in-process queue, so two deploys into one project cannot both
   * pass the name check; a second API replica would need a database lock.
   */
  private async serialized<T>(projectId: string, run: () => Promise<T>) {
    const previous = this.running.get(projectId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(run);
    this.running.set(projectId, current);
    try {
      return await current;
    } finally {
      if (this.running.get(projectId) === current)
        this.running.delete(projectId);
    }
  }

  /** Names compare without case, as people read them on the canvas. */
  private async assertNamesFree(projectId: string, names: string[]) {
    const rows = await this.db
      .select({ name: workload.name })
      .from(workload)
      .where(eq(workload.project_id, projectId));
    const taken = new Set(rows.map((row) => row.name.toLowerCase()));
    const clash = names.find((candidate) => taken.has(candidate.toLowerCase()));
    if (clash) {
      throw new ConflictException(
        `This project already has a service named "${clash}"; choose another name`,
      );
    }
  }

  private async install(
    template: MarketplaceTemplate,
    projectId: string,
    newProject: boolean,
    names: string[],
    inputs: Record<string, string>,
    author: VersionAuthorInput | null,
  ): Promise<MarketplaceDeployment> {
    const created: Workload[] = [];

    try {
      for (const [index, service] of template.services.entries()) {
        created.push(
          await this.workloads.create(projectId, {
            name: names[index],
            type: 'docker',
            config: this.config(service.image, {
              volumes: service.volumes?.map((volume) => ({
                mount_path: volume.path,
                size_gb: volume.size_gib,
                storage_class_id: null,
              })),
            }),
          }),
        );
      }

      const publicIndex = template.services.findIndex((s) => s.public);
      const appHost =
        publicIndex === -1
          ? null
          : await this.generateDomain(
              projectId,
              created[publicIndex].id,
              template.services[publicIndex].port!,
            );

      const context: RenderContext = {
        inputs,
        hosts: Object.fromEntries(
          template.services.map((service, index) => [
            service.name,
            created[index].internal_domain!,
          ]),
        ),
        appHost,
        secrets: new Map(),
      };

      for (const [index, service] of template.services.entries()) {
        if (service.env.length === 0 && !service.command) continue;
        await this.workloads.update(projectId, created[index].id, {
          config: this.config(service.image, {
            env: service.env.map(({ key, value }) => ({
              key,
              value: render(value, context),
            })),
            command: service.command?.map((value) => render(value, context)),
          }),
        });
      }

      for (const workload of created) {
        await this.workloads.deploy(projectId, workload.id, author);
      }

      return {
        project_id: projectId,
        workload_ids: created.map((workload) => workload.id),
        url: appHost ? `https://${appHost}` : null,
      };
    } catch (error) {
      const left = await this.cleanUp(projectId, created, newProject);
      if (left === null) throw error;
      // The user must learn that something is still there to delete by hand.
      throw new HttpException(
        `${error instanceof HttpException ? error.message : 'The deploy failed.'} ${left}`,
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR,
        { cause: error },
      );
    }
  }

  /** New services run without limits, like a service made in the console. */
  private config(
    image: string,
    rest: Partial<DockerWorkloadConfig>,
  ): DockerWorkloadConfig {
    return { docker_image: image, cpu_max: null, ram_max: null, ...rest };
  }

  /** The project to deploy into, or null when a new one is to be created. */
  private async existingProject(
    payload: DeployMarketplaceAppPayload,
  ): Promise<string | null> {
    const id = payload?.project_id;
    if ((id === undefined) === (payload?.project_name === undefined)) {
      throw new BadRequestException('Pass either project_id or project_name');
    }
    if (id === undefined) {
      if (typeof payload.project_name !== 'string')
        throw new BadRequestException('project_name must be text');
      normalizeName(payload.project_name);
      return null;
    }
    if (
      typeof id !== 'string' ||
      !UUID.test(id) ||
      !(await this.projects.exists(id))
    )
      throw new NotFoundException('Project not found');
    return id;
  }

  /** The suggested sslip.io label, or a suffixed one when another app holds it. */
  private async generateDomain(
    projectId: string,
    workloadId: string,
    port: number,
  ): Promise<string> {
    const { suggested_label: label } = await this.network.list(
      projectId,
      workloadId,
    );
    try {
      return (
        await this.network.generate(projectId, workloadId, { label, port })
      ).hostname;
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const suffixed = `${label.slice(0, 20)}-${randomBytes(3).toString('hex')}`;
      return (
        await this.network.generate(projectId, workloadId, {
          label: suffixed,
          port,
        })
      ).hostname;
    }
  }

  /**
   * Best effort: the deploy error is the one the user needs to see. Returns
   * what could not be removed, as a sentence for the user, or null.
   */
  private async cleanUp(
    projectId: string,
    created: Workload[],
    removeProject: boolean,
  ): Promise<string | null> {
    const attempt = async (what: string, run: () => Promise<void>) => {
      try {
        await run();
        return true;
      } catch (error) {
        this.logger.error(
          `Failed to remove ${what} after a failed marketplace deploy: ${(error as Error).message}`,
        );
        return false;
      }
    };
    if (removeProject) {
      return (await attempt(`project ${projectId}`, () =>
        this.projects.remove(projectId),
      ))
        ? null
        : 'The new project could not be removed; delete it in the console.';
    }
    // One at a time, so a service that fails to go does not keep the rest.
    const left: Workload[] = [];
    for (const service of created) {
      const removed = await attempt(
        `service ${service.id} in project ${projectId}`,
        () => this.workloads.remove(projectId, service.id),
      );
      if (!removed) left.push(service);
    }
    return left.length === 0
      ? null
      : `Services ${left.map((w) => `"${w.name}"`).join(', ')} could not be removed; delete them in the console.`;
  }
}
