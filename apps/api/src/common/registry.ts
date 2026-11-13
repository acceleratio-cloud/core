/**
 * The in-cluster image registry `scripts/install.sh` runs for services built
 * from GitHub.
 *
 * Build Jobs push to it through cluster DNS (`BUILD_REGISTRY`). Nodes cannot
 * resolve cluster DNS (containerd runs on the host network), so workloads
 * reference images as `REGISTRY_PULL_HOST/...` and every node maps that name
 * to the Service's fixed ClusterIP in `/etc/rancher/k3s/registries.yaml`.
 */

/** Keep in step with REGISTRY_HOST in scripts/install.sh. */
export const REGISTRY_PULL_HOST = 'registry.acceleratio.internal';
export const REGISTRY_PORT = 5000;

const DEFAULT_SERVICE_CIDR = '10.43.0.0/16';

/** Where build Jobs push, inside the cluster. */
export const buildRegistry = (env: NodeJS.ProcessEnv = process.env): string =>
  env.BUILD_REGISTRY?.trim() ||
  `registry.acceleratio.svc.cluster.local:${REGISTRY_PORT}`;

/** The registry Service's ClusterIP, derived from the service CIDR like install.sh does. */
export const registryClusterIp = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const explicit = env.REGISTRY_CLUSTER_IP?.trim();

  if (explicit) {
    return explicit;
  }

  const base = (env.K3S_SERVICE_CIDR?.trim() || DEFAULT_SERVICE_CIDR).split(
    '/',
  )[0];

  return `${base.slice(0, base.lastIndexOf('.'))}.50`;
};

/** k3s `registries.yaml` with the registry mirror; matches install.sh. */
export const registriesYaml = (clusterIp: string): string =>
  [
    '# Managed by Acceleratio console',
    'mirrors:',
    `  "${REGISTRY_PULL_HOST}":`,
    '    endpoint:',
    `      - "http://${clusterIp}:${REGISTRY_PORT}"`,
    '',
  ].join('\n');
