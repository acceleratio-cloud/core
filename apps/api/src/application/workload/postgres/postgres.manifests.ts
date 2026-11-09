import type { V1Secret, V1Service } from '@kubernetes/client-node';
import type { PostgresConfig, WorkloadStatus } from '@acceleratio/shared';
import {
  CILIUM_GROUP,
  CILIUM_VERSION,
  NAMESPACE_LABEL,
} from '@/application/project/cilium';
import { projectNamespace } from '@/common/naming';
import {
  containerResources,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  PROJECT_ID_LABEL,
  WORKLOAD_ID_LABEL,
  WORKLOAD_NAME_ANNOTATION,
} from '../docker/docker-workload.manifests';

export const CNPG_GROUP = 'postgresql.cnpg.io';
export const CNPG_VERSION = 'v1';
export const CNPG_CLUSTER_PLURAL = 'clusters';
export const CNPG_CLUSTER_LABEL = 'cnpg.io/cluster';
export const CNPG_ROLE_LABEL = 'cnpg.io/instanceRole';
export const HIBERNATION_ANNOTATION = 'cnpg.io/hibernation';
/** The annotation `kubectl cnpg restart` sets; CNPG restarts the instances. */
export const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';
/** Lets CNPG pick up a changed password without a restart. */
export const CNPG_RELOAD_LABEL = 'cnpg.io/reload';
export const POSTGRES_CONTAINER = 'postgres';
export const POSTGRES_PORT = 5432;
/** CNPG's built-in exporter on every instance. */
export const METRICS_PORT = 9187;
export const DEFAULT_METRICS_NAMESPACE = 'victoria-metrics';

/** Where VictoriaMetrics runs; it scrapes the exporter from there. */
const metricsNamespace = (): string =>
  process.env.VICTORIAMETRICS_NAMESPACE?.trim() || DEFAULT_METRICS_NAMESPACE;
export const POSTGRES_DATABASE = 'app';
export const POSTGRES_USERNAME = 'app';
export const DEFAULT_CNPG_NAMESPACE = 'cnpg-system';
export const DEFAULT_POSTGRES_IMAGE_REPOSITORY =
  'ghcr.io/cloudnative-pg/postgresql';

/** Where pods of every namespace get their addresses (k3s `cluster-cidr`). */
export const DEFAULT_POD_CIDR = '10.42.0.0/16';
/** On the external Service: the source networks its policy allows. */
export const ALLOWED_CIDRS_ANNOTATION = 'acceleratio.io/allowed-cidrs';

export const externalServiceName = (externalName: string): string =>
  `${externalName}-external`;

/**
 * Clients outside the pod network must use TLS; CNPG puts these rules before
 * its own catch-all. Pods keep plain connections, which many drivers default
 * to.
 */
export const tlsOutsidePodNetwork = (
  podCidr: string = DEFAULT_POD_CIDR,
): string[] => [
  `hostnossl all all ${podCidr} scram-sha-256`,
  'hostnossl all all 0.0.0.0/0 reject',
  'hostnossl all all ::/0 reject',
];

export const credentialsSecretName = (externalName: string): string =>
  `${externalName}-credentials`;

export const clusterPolicyName = (externalName: string): string =>
  `${externalName}-postgres`;

/** The read-write Service CNPG creates for the primary. */
export const readWriteHost = (
  externalName: string,
  projectId: string,
): string => `${externalName}-rw.${projectNamespace(projectId)}.svc`;

export interface PostgresManifestInput {
  id: string;
  project_id: string;
  name: string;
  external_name: string;
}

const labels = (input: PostgresManifestInput) => ({
  [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  [PROJECT_ID_LABEL]: input.project_id,
  [WORKLOAD_ID_LABEL]: input.id,
});

const metadata = (input: PostgresManifestInput, name: string) => ({
  name,
  namespace: projectNamespace(input.project_id),
  labels: labels(input),
  annotations: { [WORKLOAD_NAME_ANNOTATION]: input.name },
});

/** The subset of a CNPG Cluster this API writes and reads. */
export interface CnpgCluster {
  apiVersion: string;
  kind: 'Cluster';
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    resourceVersion?: string;
  };
  spec: Record<string, unknown>;
  status?: {
    phase?: string;
    phaseReason?: string;
    readyInstances?: number;
    instances?: number;
    conditions?: Array<{ type?: string; status?: string; message?: string }>;
  };
}

export const buildCluster = (
  input: PostgresManifestInput,
  config: PostgresConfig,
  storageClassName: string,
  imageRepository: string = DEFAULT_POSTGRES_IMAGE_REPOSITORY,
  podCidr?: string,
): CnpgCluster => ({
  apiVersion: `${CNPG_GROUP}/${CNPG_VERSION}`,
  kind: 'Cluster',
  metadata: metadata(input, input.external_name),
  spec: {
    instances: 1,
    imageName: `${imageRepository}:${config.postgres_version}`,
    // A disruption budget on the only instance would block node drains.
    enablePDB: false,
    storage: { size: `${config.size_gb}Gi`, storageClass: storageClassName },
    resources: containerResources(config),
    postgresql: {
      pg_hba: tlsOutsidePodNetwork(podCidr),
      // The default 1 GB of WAL can fill a small disk alone; keep it to a
      // quarter of the volume.
      parameters: { max_wal_size: `${config.size_gb * 256}MB` },
    },
    bootstrap: {
      initdb: {
        database: POSTGRES_DATABASE,
        owner: POSTGRES_USERNAME,
        secret: { name: credentialsSecretName(input.external_name) },
      },
    },
    // Pods carry the workload labels, so logs, metrics and the terminal
    // find them like a Docker service's. The annotations let the bundled
    // VictoriaMetrics scrape the exporter (its `kubernetes-pods` job).
    inheritedMetadata: {
      labels: labels(input),
      annotations: {
        'prometheus.io/scrape': 'true',
        'prometheus.io/port': String(METRICS_PORT),
      },
    },
  },
});

export const buildCredentialsSecret = (
  input: PostgresManifestInput,
  password: string,
): V1Secret => {
  const base = metadata(input, credentialsSecretName(input.external_name));

  return {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'kubernetes.io/basic-auth',
    metadata: {
      ...base,
      labels: { ...base.labels, [CNPG_RELOAD_LABEL]: 'true' },
    },
    stringData: { username: POSTGRES_USERNAME, password },
  };
};

/**
 * The project policy denies traffic from other namespaces and to the API
 * server. A CNPG instance needs both: the operator calls its instance
 * manager, and the instance manager watches its Cluster. VictoriaMetrics
 * scrapes the exporter port too. Cilium policies add up, so this one opens
 * only that, only for this cluster's pods.
 */
export const buildClusterPolicy = (
  input: PostgresManifestInput,
  operatorNamespace: string = DEFAULT_CNPG_NAMESPACE,
  /** Networks the database port is open to from outside; empty keeps it closed. */
  allowedCidrs: string[] = [],
  scraperNamespace: string = metricsNamespace(),
) => ({
  apiVersion: `${CILIUM_GROUP}/${CILIUM_VERSION}`,
  kind: 'CiliumNetworkPolicy',
  metadata: metadata(input, clusterPolicyName(input.external_name)),
  spec: {
    endpointSelector: {
      matchLabels: { [CNPG_CLUSTER_LABEL]: input.external_name },
    },
    ingress: [
      {
        fromEndpoints: [
          { matchLabels: { [NAMESPACE_LABEL]: operatorNamespace } },
        ],
      },
      {
        fromEndpoints: [
          { matchLabels: { [NAMESPACE_LABEL]: scraperNamespace } },
        ],
        toPorts: [{ ports: [{ port: String(METRICS_PORT), protocol: 'TCP' }] }],
      },
      // The external Service keeps the client address
      // (`externalTrafficPolicy: Local`), so the networks match it.
      ...(allowedCidrs.length > 0
        ? [
            {
              fromCIDR: allowedCidrs,
              toPorts: [
                { ports: [{ port: String(POSTGRES_PORT), protocol: 'TCP' }] },
              ],
            },
          ]
        : []),
    ],
    egress: [{ toEntities: ['kube-apiserver'] }],
  },
});

/**
 * The database port on every node. `Local` keeps the client address for the
 * policy, and only the node that runs the primary answers.
 */
export const buildExternalService = (
  input: PostgresManifestInput,
  allowedCidrs: string[],
  nodePort: number | null,
): V1Service => {
  const base = metadata(input, externalServiceName(input.external_name));

  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      ...base,
      annotations: {
        ...base.annotations,
        [ALLOWED_CIDRS_ANNOTATION]: allowedCidrs.join(','),
      },
    },
    spec: {
      type: 'NodePort',
      externalTrafficPolicy: 'Local',
      selector: {
        [CNPG_CLUSTER_LABEL]: input.external_name,
        [CNPG_ROLE_LABEL]: 'primary',
      },
      ports: [
        {
          name: 'postgres',
          port: POSTGRES_PORT,
          targetPort: POSTGRES_PORT,
          protocol: 'TCP',
          ...(nodePort === null ? {} : { nodePort }),
        },
      ],
    },
  };
};

const HEALTHY_PHASE = 'Cluster in healthy state';
const FAILED_PHASE = /unable|cannot|unrecoverable|failed|error/i;

/** A database's status, read from its Cluster: the cluster is the only record. */
export const clusterStatus = (
  cluster: CnpgCluster | null,
): { status: WorkloadStatus; status_message: string | null } => {
  if (cluster === null) {
    return {
      status: 'failed',
      status_message: 'The database is missing from the cluster',
    };
  }

  const hibernating =
    cluster.metadata.annotations?.[HIBERNATION_ANNOTATION] === 'on';
  const hibernated = cluster.status?.conditions?.some(
    (condition) =>
      condition.type === HIBERNATION_ANNOTATION && condition.status === 'True',
  );

  if (hibernating) {
    return {
      status: hibernated ? 'stopped' : 'deploying',
      status_message: null,
    };
  }

  const phase = cluster.status?.phase ?? '';
  const reason = cluster.status?.phaseReason || phase || null;

  if (phase === HEALTHY_PHASE && (cluster.status?.readyInstances ?? 0) > 0) {
    return { status: 'running', status_message: null };
  }

  if (FAILED_PHASE.test(phase)) {
    return { status: 'failed', status_message: reason };
  }

  return { status: 'deploying', status_message: reason };
};
