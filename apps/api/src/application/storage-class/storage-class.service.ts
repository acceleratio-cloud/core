import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { V1StorageClass } from '@kubernetes/client-node';
import type {
  CreateStorageClassPayload,
  StorageBenchmark,
  StorageClass,
  StorageEnvironment,
  UpdateStorageClassPayload,
} from '@acceleratio/shared';
import {
  and,
  asc,
  count as countRows,
  desc,
  eq,
  inArray,
  sql,
} from 'drizzle-orm';
import {
  CONFLICT_ID_PREFIX_LENGTH,
  storageClassExternalName,
} from '@/common/naming';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  getKubernetesStatusCode,
  toNestException,
} from '@/vendor/kubernetes/kubernetes-error';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { workload } from '@/application/workload/schemas/workload.schema';
import { workloadVersion } from '@/application/workload/schemas/workload-version.schema';
import { toStorageBenchmark } from './benchmark/storage-benchmark.results';
import { storageBenchmark } from './schemas/storage-benchmark.schema';
import {
  storageClass,
  type NewStorageClassRow,
  type StorageClassRow,
} from './schemas/storage-class.schema';
import {
  normalizeCreatePayload,
  normalizeUpdatePayload,
} from './storage-class.config';
import {
  buildStorageClass,
  DEFAULT_CLASS_ANNOTATION,
  fromDriverParameters,
  isManagedStorageClass,
  LONGHORN_PROVISIONER,
  type StorageClassManifestInput,
} from './storage-class.manifests';
import {
  deriveCustomClusterStatus,
  derivePlatformClusterStatus,
} from './storage-class.status';

export const DEFAULT_PLATFORM_STORAGE_CLASS_NAME = 'longhorn';

interface LonghornNode {
  spec?: { allowScheduling?: boolean };
  status?: { conditions?: { type?: string; status?: string }[] };
}
export const PLATFORM_FORBIDDEN_MESSAGE =
  'The platform storage class is managed by the installer and cannot be changed';
const NOT_FOUND_MESSAGE = 'Storage class not found';
const UNMANAGED_MESSAGE =
  'The StorageClass in the cluster is not managed by Acceleratio';
const NAME_TAKEN_MESSAGE =
  'A StorageClass with this name already exists in the cluster';
const REFERENCED_MESSAGE =
  'Storage class is still referenced by other resources';
const PLATFORM_NAME = 'Platform default';
const PLATFORM_DESCRIPTION =
  'Created by the installer. Volumes use it unless another class is chosen.';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const EXTERNAL_NAME_CONSTRAINT = 'storage_class_external_name_unique';

/** What the cluster reports, or undefined when it could not be listed. */
interface ClusterState {
  classes: Map<string, V1StorageClass>;
  volumeCounts: Map<string, number>;
}

/**
 * Drizzle wraps driver failures, so the PostgreSQL error code and constraint
 * can sit on the error or on one of its causes.
 */
const findDatabaseError = (
  error: unknown,
  code: string,
): { constraint?: unknown } | undefined => {
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

    if (candidate.code === code) {
      return candidate;
    }

    current = candidate.cause;
  }

  return undefined;
};

const isExternalNameConflict = (error: unknown): boolean => {
  const found = findDatabaseError(error, UNIQUE_VIOLATION);

  return (
    found !== undefined &&
    (found.constraint === undefined ||
      found.constraint === EXTERNAL_NAME_CONSTRAINT)
  );
};

const plural = (count: number, word: string, many = `${word}s`) =>
  `${count} ${count === 1 ? word : many}`;

@Injectable()
export class StorageClassService {
  private readonly logger = new Logger(StorageClassService.name);
  private platformEnsured = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly kubernetes: KubernetesService,
  ) {}

  get platformName(): string {
    return (
      process.env.PLATFORM_STORAGE_CLASS_NAME?.trim() ||
      DEFAULT_PLATFORM_STORAGE_CLASS_NAME
    );
  }

  async list(): Promise<StorageClass[]> {
    await this.ensurePlatformRow();

    const [rows, cluster, benchmarks] = await Promise.all([
      this.db
        .select()
        .from(storageClass)
        // The platform class first, then custom classes oldest first.
        .orderBy(
          sql`case when ${storageClass.kind} = 'platform' then 0 else 1 end`,
          asc(storageClass.created_at),
          asc(storageClass.id),
        ),
      this.readClusterState(),
      this.latestBenchmarks(),
    ]);

    return rows.map((row) =>
      this.present(row, cluster, benchmarks.get(row.id) ?? null),
    );
  }

  async get(id: string): Promise<StorageClass> {
    await this.ensurePlatformRow();

    const [row, cluster, benchmarks] = await Promise.all([
      this.findRow(id),
      this.readClusterState(),
      this.latestBenchmarks(id),
    ]);

    return this.present(row, cluster, benchmarks.get(row.id) ?? null);
  }

  /**
   * The Kubernetes StorageClass name a volume claim uses: the given profile's,
   * or the platform class when none is chosen. Database only, so a save or
   * deploy does not wait on the cluster.
   */
  async kubernetesName(id: string | null): Promise<string> {
    if (id === null) {
      return this.platformName;
    }

    return (await this.findRow(id)).external_name;
  }

  /**
   * Checks a profile a new volume is created on. A `Retain` profile keeps
   * the data after its claim is deleted, as a released volume nobody can
   * reach from the console, so deleting a Docker volume would not delete its
   * data. The platform profile is the installer's and deletes.
   */
  async assertVolumeProfile(id: string | null): Promise<void> {
    if (id === null) {
      return;
    }

    const row = await this.findRow(id);

    if (row.reclaim_policy === 'Retain') {
      throw new BadRequestException(
        `Storage profile ${row.name} keeps data after a volume is deleted; choose a profile that deletes it`,
      );
    }
  }

  async create(payload: CreateStorageClassPayload): Promise<StorageClass> {
    const input = normalizeCreatePayload(payload);
    const nodes = await this.readStorageNodes();

    // Longhorn places each copy on a different server.
    if (nodes !== null && input.parameters.number_of_replicas > nodes) {
      throw new BadRequestException(
        `${plural(input.parameters.number_of_replicas, 'copy', 'copies')} on different servers need ${input.parameters.number_of_replicas} storage servers; the cluster has ${nodes}`,
      );
    }

    // Generated here so external_name is known before the single insert.
    const id = randomUUID();
    const values: NewStorageClassRow = {
      id,
      kind: 'custom',
      name: input.name,
      description: input.description,
      external_name: storageClassExternalName(input.name, id),
      parameters: input.parameters,
      reclaim_policy: input.reclaim_policy,
      volume_binding_mode: input.volume_binding_mode,
      allow_volume_expansion: input.allow_volume_expansion,
    };

    const row = await this.insertRow(values);

    let created: V1StorageClass;

    try {
      created = await this.kubernetes.storageV1.createStorageClass({
        body: buildStorageClass(this.toManifestInput(row)),
      });
    } catch (error) {
      await this.deleteRowAfterFailedCreate(row.id);

      if (getKubernetesStatusCode(error) === 409) {
        throw new ConflictException(NAME_TAKEN_MESSAGE);
      }

      this.logger.warn(
        `Failed to create StorageClass ${row.external_name}: ${(error as Error).message}`,
      );
      throw toNestException(error);
    }

    return this.present(
      row,
      {
        classes: new Map([[row.external_name, created]]),
        volumeCounts: new Map(),
      },
      null,
    );
  }

  async update(
    id: string,
    payload: UpdateStorageClassPayload,
  ): Promise<StorageClass> {
    const row = await this.findRow(id);

    if (row.kind === 'platform') {
      throw new ForbiddenException(PLATFORM_FORBIDDEN_MESSAGE);
    }

    const changes = normalizeUpdatePayload(payload);

    if (
      changes.allow_volume_expansion !== undefined &&
      changes.allow_volume_expansion !== row.allow_volume_expansion
    ) {
      await this.patchVolumeExpansion(row, changes.allow_volume_expansion);
    }

    if (Object.keys(changes).length > 0) {
      const [updated] = await this.db
        .update(storageClass)
        .set(changes)
        .where(eq(storageClass.id, id))
        .returning();

      if (!updated) {
        throw new NotFoundException(NOT_FOUND_MESSAGE);
      }
    }

    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const row = await this.findRow(id);

    if (row.kind === 'platform') {
      throw new ForbiddenException(PLATFORM_FORBIDDEN_MESSAGE);
    }

    const services = await this.countVolumeServices(row.id);

    if (services > 0) {
      throw new ConflictException(
        `Storage class is used by volumes of ${plural(services, 'Docker service')}. Delete those volumes first.`,
      );
    }

    const volumes = await this.countVolumes(row.external_name);

    if (volumes > 0) {
      throw new ConflictException(
        `Storage class is used by ${plural(volumes, 'volume')}. Delete them first.`,
      );
    }

    const live = await this.readStorageClass(row.external_name);

    if (live && !isManagedStorageClass(live, row.id)) {
      throw new ConflictException(UNMANAGED_MESSAGE);
    }

    try {
      // The row goes inside the transaction so a future reference
      // (`on delete restrict`) aborts before the cluster object is touched,
      // and a failed cluster delete keeps the row.
      await this.db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(storageClass)
          .where(eq(storageClass.id, id))
          .returning({ id: storageClass.id });

        if (!deleted) {
          throw new NotFoundException(NOT_FOUND_MESSAGE);
        }

        if (live) {
          await this.deleteStorageClass(row.external_name);
        }
      });
    } catch (error) {
      if (findDatabaseError(error, FOREIGN_KEY_VIOLATION)) {
        throw new ConflictException(REFERENCED_MESSAGE);
      }

      throw error;
    }
  }

  async environment(): Promise<StorageEnvironment> {
    const [csiDriverInstalled, storageNodes] = await Promise.all([
      this.readCsiDriverInstalled(),
      this.readStorageNodes(),
    ]);

    return {
      csi_driver_installed: csiDriverInstalled,
      storage_nodes: storageNodes,
    };
  }

  /**
   * Idempotent: anchors the installer's class with a stable id so other
   * resources can reference it. Runs once per process after it succeeds.
   */
  private async ensurePlatformRow(): Promise<void> {
    if (this.platformEnsured) {
      return;
    }

    await this.db
      .insert(storageClass)
      .values({
        kind: 'platform',
        name: PLATFORM_NAME,
        description: PLATFORM_DESCRIPTION,
        external_name: this.platformName,
      })
      .onConflictDoNothing();

    this.platformEnsured = true;
  }

  private async insertRow(
    values: NewStorageClassRow,
  ): Promise<StorageClassRow> {
    try {
      const [row] = await this.db
        .insert(storageClass)
        .values(values)
        .returning();

      return row;
    } catch (error) {
      if (!isExternalNameConflict(error)) {
        throw error;
      }
    }

    try {
      const [row] = await this.db
        .insert(storageClass)
        .values({
          ...values,
          external_name: storageClassExternalName(
            values.name,
            values.id as string,
            CONFLICT_ID_PREFIX_LENGTH,
          ),
        })
        .returning();

      return row;
    } catch (error) {
      if (isExternalNameConflict(error)) {
        throw new ConflictException(NAME_TAKEN_MESSAGE);
      }

      throw error;
    }
  }

  /** The newest benchmark per profile (one row each, `distinct on`). */
  private async latestBenchmarks(
    id?: string,
  ): Promise<Map<string, StorageBenchmark>> {
    const query = this.db
      .selectDistinctOn([storageBenchmark.storage_class_id])
      .from(storageBenchmark);
    const rows = await (
      id ? query.where(eq(storageBenchmark.storage_class_id, id)) : query
    ).orderBy(
      storageBenchmark.storage_class_id,
      desc(storageBenchmark.created_at),
    );

    return new Map(
      rows.flatMap((row) =>
        row.storage_class_id
          ? [[row.storage_class_id, toStorageBenchmark(row)] as const]
          : [],
      ),
    );
  }

  private async findRow(id: string): Promise<StorageClassRow> {
    const [row] = await this.db
      .select()
      .from(storageClass)
      .where(eq(storageClass.id, id))
      .limit(1);

    if (!row) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }

    return row;
  }

  private async patchVolumeExpansion(
    row: StorageClassRow,
    allow: boolean,
  ): Promise<void> {
    const live = await this.readStorageClass(row.external_name);

    if (live === null) {
      // Nothing to patch; the row keeps the desired state and the class
      // reports `missing`.
      return;
    }

    if (!isManagedStorageClass(live, row.id)) {
      throw new ConflictException(UNMANAGED_MESSAGE);
    }

    try {
      // JSON Patch, the client's default patch format. `add` replaces the
      // field when it is already present.
      await this.kubernetes.storageV1.patchStorageClass({
        name: row.external_name,
        body: [{ op: 'add', path: '/allowVolumeExpansion', value: allow }],
      });
    } catch (error) {
      this.logger.warn(
        `Failed to patch StorageClass ${row.external_name}: ${(error as Error).message}`,
      );
      throw toNestException(error);
    }
  }

  private async readStorageClass(name: string): Promise<V1StorageClass | null> {
    try {
      return await this.kubernetes.storageV1.readStorageClass({ name });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return null;
      }

      throw toNestException(error);
    }
  }

  private async deleteStorageClass(name: string): Promise<void> {
    try {
      await this.kubernetes.storageV1.deleteStorageClass({ name });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        return;
      }

      this.logger.warn(
        `Failed to delete StorageClass ${name}: ${(error as Error).message}`,
      );
      throw toNestException(error);
    }
  }

  /**
   * Docker services whose pending or running config has a volume on this
   * profile. Claims are only created on deploy, so the cluster alone would
   * miss volumes that are saved but not deployed yet.
   */
  private async countVolumeServices(id: string): Promise<number> {
    const reference = JSON.stringify([{ storage_class_id: id }]);
    const [result] = await this.db
      .select({ value: countRows() })
      .from(workload)
      .leftJoin(
        workloadVersion,
        eq(workloadVersion.id, workload.active_version_id),
      )
      .where(
        and(
          inArray(workload.type, ['docker', 'github']),
          sql`(${workload.draft_config} -> 'volumes' @> ${reference}::jsonb or ${workloadVersion.config} -> 'volumes' @> ${reference}::jsonb)`,
        ),
      );

    return result?.value ?? 0;
  }

  private async countVolumes(name: string): Promise<number> {
    try {
      const [volumes, claims] = await Promise.all([
        this.kubernetes.coreV1.listPersistentVolume(),
        this.kubernetes.coreV1.listPersistentVolumeClaimForAllNamespaces(),
      ]);
      const volumeNames = new Set(
        volumes.items
          .filter((volume) => volume.spec?.storageClassName === name)
          .map((volume) => volume.metadata?.name ?? ''),
      );
      const unboundClaims = claims.items.filter(
        (claim) =>
          claim.spec?.storageClassName === name &&
          !volumeNames.has(claim.spec?.volumeName ?? ''),
      ).length;

      return volumeNames.size + unboundClaims;
    } catch (error) {
      this.logger.warn(
        `Failed to count volumes of StorageClass ${name}: ${(error as Error).message}`,
      );
      throw toNestException(error);
    }
  }

  /** List reads degrade to `unknown` instead of failing the whole page. */
  private async readClusterState(): Promise<ClusterState | undefined> {
    try {
      const [classes, volumes] = await Promise.all([
        this.kubernetes.storageV1.listStorageClass(),
        this.kubernetes.coreV1.listPersistentVolume(),
      ]);
      const volumeCounts = new Map<string, number>();

      for (const volume of volumes.items) {
        const name = volume.spec?.storageClassName;

        if (name) {
          volumeCounts.set(name, (volumeCounts.get(name) ?? 0) + 1);
        }
      }

      return {
        classes: new Map(
          classes.items.map((item) => [item.metadata?.name ?? '', item]),
        ),
        volumeCounts,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to read StorageClasses: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  private async readCsiDriverInstalled(): Promise<boolean | null> {
    try {
      await this.kubernetes.storageV1.readCSIDriver({
        name: LONGHORN_PROVISIONER,
      });
      return true;
    } catch (error) {
      return getKubernetesStatusCode(error) === 404 ? false : null;
    }
  }

  /** Longhorn nodes that are Ready and accept new copies. */
  private async readStorageNodes(): Promise<number | null> {
    try {
      const list =
        (await this.kubernetes.customObjects.listNamespacedCustomObject({
          group: 'longhorn.io',
          version: 'v1beta2',
          namespace:
            process.env.LONGHORN_NAMESPACE?.trim() || 'longhorn-system',
          plural: 'nodes',
        })) as { items?: LonghornNode[] };

      return (list.items ?? []).filter(
        (node) =>
          node.spec?.allowScheduling !== false &&
          node.status?.conditions?.some(
            (condition) =>
              condition.type === 'Ready' && condition.status === 'True',
          ),
      ).length;
    } catch {
      return null;
    }
  }

  /**
   * Best-effort cleanup after a failed cluster create. The original error is
   * the one that reaches the client, so a cleanup failure is only logged.
   */
  private async deleteRowAfterFailedCreate(id: string): Promise<void> {
    try {
      await this.db.delete(storageClass).where(eq(storageClass.id, id));
    } catch (error) {
      this.logger.error(
        `Failed to roll back storage class ${id}: ${(error as Error).message}`,
      );
    }
  }

  private toManifestInput(row: StorageClassRow): StorageClassManifestInput {
    return {
      id: row.id,
      external_name: row.external_name,
      // A custom row always stores its settings; the fallbacks only satisfy
      // the nullable columns the platform row needs.
      parameters: row.parameters ?? fromDriverParameters({}).parameters,
      reclaim_policy: row.reclaim_policy ?? 'Delete',
      volume_binding_mode: row.volume_binding_mode ?? 'Immediate',
      allow_volume_expansion: row.allow_volume_expansion,
    };
  }

  private present(
    row: StorageClassRow,
    cluster: ClusterState | undefined,
    latestBenchmark: StorageBenchmark | null,
  ): StorageClass {
    const live = cluster
      ? (cluster.classes.get(row.external_name) ?? null)
      : undefined;
    const volumeCount = cluster
      ? (cluster.volumeCounts.get(row.external_name) ?? 0)
      : null;
    const common = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description,
      external_name: row.external_name,
      volume_count: volumeCount,
      latest_benchmark: latestBenchmark,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };

    if (row.kind === 'platform') {
      const parsed = live ? fromDriverParameters(live.parameters) : null;

      return {
        ...common,
        provisioner: live?.provisioner ?? LONGHORN_PROVISIONER,
        // Until the cluster says otherwise, the platform class is the default.
        is_default: live
          ? live.metadata?.annotations?.[DEFAULT_CLASS_ANNOTATION] === 'true'
          : true,
        editable: false,
        parameters: parsed?.parameters ?? null,
        extra_parameters: parsed?.extra ?? {},
        reclaim_policy:
          (live?.reclaimPolicy as StorageClass['reclaim_policy']) ??
          (live ? 'Delete' : null),
        volume_binding_mode:
          (live?.volumeBindingMode as StorageClass['volume_binding_mode']) ??
          (live ? 'Immediate' : null),
        allow_volume_expansion: live?.allowVolumeExpansion ?? false,
        cluster_status: derivePlatformClusterStatus(live),
      };
    }

    const desired = this.toManifestInput(row);

    return {
      ...common,
      provisioner: LONGHORN_PROVISIONER,
      is_default: false,
      editable: true,
      parameters: desired.parameters,
      extra_parameters: {},
      reclaim_policy: desired.reclaim_policy,
      volume_binding_mode: desired.volume_binding_mode,
      allow_volume_expansion: desired.allow_volume_expansion,
      cluster_status: deriveCustomClusterStatus(desired, live),
    };
  }
}
