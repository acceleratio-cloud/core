import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { projectNamespace } from '@/common/naming';
import type { Database } from '@/vendor/db/database.constants';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { WORKLOAD_ID_LABEL } from '../docker/docker-workload.manifests';
import { workload, type WorkloadRow } from '../schemas/workload.schema';
import {
  CNPG_CLUSTER_PLURAL,
  CNPG_GROUP,
  CNPG_VERSION,
  type CnpgCluster,
} from './postgres.manifests';

/** A PostgreSQL workload of the project, or 404. */
export const findPostgresRow = async (
  db: Database,
  projectId: string,
  id: string,
): Promise<WorkloadRow> => {
  const [row] = await db
    .select()
    .from(workload)
    .where(
      and(
        eq(workload.id, id),
        eq(workload.project_id, projectId),
        eq(workload.type, 'postgres'),
      ),
    )
    .limit(1);

  if (!row) {
    throw new NotFoundException('Workload not found');
  }

  return row;
};

/**
 * The database's Cluster; null when it is missing or carries another
 * workload's label, since a Cluster this workload did not create is not its.
 */
export const readPostgresCluster = async (
  kubernetes: KubernetesService,
  row: WorkloadRow,
): Promise<CnpgCluster | null> => {
  try {
    const cluster = (await kubernetes.customObjects.getNamespacedCustomObject({
      group: CNPG_GROUP,
      version: CNPG_VERSION,
      namespace: projectNamespace(row.project_id),
      plural: CNPG_CLUSTER_PLURAL,
      name: row.external_name,
    })) as CnpgCluster;

    return cluster.metadata.labels?.[WORKLOAD_ID_LABEL] === row.id
      ? cluster
      : null;
  } catch (error) {
    if (getKubernetesStatusCode(error) === 404) {
      return null;
    }

    throw error;
  }
};
