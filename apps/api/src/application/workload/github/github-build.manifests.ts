import type { V1Job, V1Namespace, V1Secret } from '@kubernetes/client-node';
import { buildRegistry } from '@/common/registry';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  WORKLOAD_ID_LABEL,
} from '../docker/docker-workload.manifests';

export const BUILD_ID_LABEL = 'acceleratio.io/build-id';
export const BUILD_CONTAINER = 'buildkit';
export const DEFAULT_BUILD_NAMESPACE = 'acceleratio-builds';
/** Rootless BuildKit; override with BUILDER_IMAGE. */
export const DEFAULT_BUILDER_IMAGE = 'moby/buildkit:v0.34.2-rootless';
/** The Job is killed after this; the API gives up a little later. */
export const BUILD_DEADLINE_SECONDS = 30 * 60;
export const BUILD_POLICY_NAME = 'acceleratio-build-isolation';

export const buildNamespace = (): string =>
  process.env.BUILD_NAMESPACE?.trim() || DEFAULT_BUILD_NAMESPACE;

export const builderImage = (): string =>
  process.env.BUILDER_IMAGE?.trim() || DEFAULT_BUILDER_IMAGE;

export const buildJobName = (buildId: string): string =>
  `build-${buildId.replace(/-/g, '').slice(0, 16)}`;

/** Repository in the registry: one per service. */
export const imageRepository = (namespace: string, workloadId: string) =>
  `${namespace}/${workloadId}`;

export interface BuildManifestInput {
  buildId: string;
  workloadId: string;
  name: string;
  namespace: string;
  /** `owner/name` on github.com. */
  repository: string;
  commitSha: string;
  /** `imageRepository(...)`. */
  imageRepository: string;
}

const labels = (input: BuildManifestInput) => ({
  [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  [BUILD_ID_LABEL]: input.buildId,
  [WORKLOAD_ID_LABEL]: input.workloadId,
});

/** The Railpack CLI and its BuildKit frontend must be the same version. */
export const RAILPACK_VERSION = 'v0.43.0';
/** Pinned by digest: the frontend shapes every image it builds. */
export const RAILPACK_FRONTEND = `ghcr.io/railwayapp/railpack-frontend:${RAILPACK_VERSION}@sha256:355ef61fae6f2551103cd8b10c710cb07167dd353d561f15c69b8d7ac1c676cc`;

/**
 * Builds the commit and pushes it: the `Dockerfile` at the repository root
 * when there is one, otherwise a Railpack plan. The commit and its submodules
 * (as BuildKit's git source fetched them) are fetched with the token in a
 * one-off header sent only to github.com, so it is never written to disk, and
 * `.git` is removed before BuildKit sees the source; `RUN` steps never see
 * the token.
 * The image digest is written to the termination message, where the API
 * reads it.
 */
export const buildScript = (): string =>
  [
    'set -eu',
    'cd "$(mktemp -d)"',
    `auth="http.https://github.com/.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$GIT_AUTH_TOKEN" | base64 | tr -d '\\n')"`,
    // Only git needs the token: nothing started later, Railpack included, inherits it.
    'unset GIT_AUTH_TOKEN',
    'git init -q src',
    'git -C src -c "$auth" fetch -q --depth 1 "$BUILD_REPOSITORY" "$BUILD_COMMIT"',
    'git -C src -c advice.detachedHead=false checkout -q FETCH_HEAD',
    'git -C src -c "$auth" submodule update -q --init --recursive --depth 1',
    'rm -rf src/.git',
    'if [ -f src/Dockerfile ]; then',
    '  echo "Building the Dockerfile"',
    '  set -- --frontend dockerfile.v0 --local context=src --local dockerfile=src',
    'else',
    `  echo "No Dockerfile: building with Railpack ${RAILPACK_VERSION}"`,
    // sha256 of the release's `railpack-<version>-<arch>-unknown-linux-musl.tar.gz`.
    '  arch="$(uname -m)"',
    '  case "$arch" in',
    '    x86_64) sha=248a8f60f36854aabed6124113631078a802de3461660855fc4de9c26065c1fb ;;',
    '    aarch64) arch=arm64 sha=732ece14eb4f4676a43ebba19431f954edf7b130acb76159ef0f2ff86ac42ac9 ;;',
    '    *) echo "error: Railpack has no build for $arch" >&2; exit 1 ;;',
    '  esac',
    `  wget -q -O railpack.tar.gz "https://github.com/railwayapp/railpack/releases/download/${RAILPACK_VERSION}/railpack-${RAILPACK_VERSION}-$arch-unknown-linux-musl.tar.gz"`,
    '  echo "$sha  railpack.tar.gz" | sha256sum -c -s || { echo "error: the Railpack download does not match its checksum" >&2; exit 1; }',
    '  tar -xzf railpack.tar.gz railpack',
    '  mkdir plan',
    '  ./railpack prepare src --plan-out plan/railpack-plan.json',
    `  set -- --frontend gateway.v0 --opt source=${RAILPACK_FRONTEND} --local context=src --local dockerfile=plan`,
    'fi',
    'buildctl-daemonless.sh build "$@" \\',
    '  --output type=image,name="$BUILD_IMAGE",push=true,registry.insecure=true \\',
    '  --import-cache type=registry,ref="$BUILD_CACHE",registry.insecure=true \\',
    '  --export-cache type=registry,ref="$BUILD_CACHE",mode=max,registry.insecure=true,ignore-error=true \\',
    '  --metadata-file /tmp/metadata.json',
    `grep -o '"containerimage.digest": *"sha256:[0-9a-f]*"' /tmp/metadata.json | grep -o 'sha256:[0-9a-f]*' > /dev/termination-log`,
  ].join('\n');

export const buildBuildNamespace = (name: string): V1Namespace => ({
  apiVersion: 'v1',
  kind: 'Namespace',
  metadata: { name, labels: { [MANAGED_BY_LABEL]: MANAGED_BY_VALUE } },
});

export const buildJob = (input: BuildManifestInput): V1Job => {
  const push = `${buildRegistry()}/${input.imageRepository}`;

  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: input.name,
      namespace: input.namespace,
      labels: labels(input),
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: BUILD_DEADLINE_SECONDS,
      // The API stores the log when the build ends; this is the fallback.
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels: labels(input) },
        spec: {
          restartPolicy: 'Never',
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          containers: [
            {
              name: BUILD_CONTAINER,
              image: builderImage(),
              command: ['sh', '-c', buildScript()],
              env: [
                {
                  name: 'BUILD_REPOSITORY',
                  value: `https://github.com/${input.repository}.git`,
                },
                { name: 'BUILD_COMMIT', value: input.commitSha },
                {
                  name: 'BUILD_IMAGE',
                  value: `${push}:${input.commitSha}`,
                },
                { name: 'BUILD_CACHE', value: `${push}:buildcache` },
                {
                  name: 'BUILDKITD_FLAGS',
                  value: '--oci-worker-no-process-sandbox',
                },
                {
                  name: 'GIT_AUTH_TOKEN',
                  valueFrom: {
                    secretKeyRef: { name: input.name, key: 'GIT_AUTH_TOKEN' },
                  },
                },
              ],
              resources: {
                requests: { cpu: '500m', memory: '1Gi' },
                limits: { cpu: '2', memory: '4Gi' },
              },
              securityContext: {
                runAsUser: 1000,
                runAsGroup: 1000,
                // Rootless BuildKit creates user namespaces and mounts.
                seccompProfile: { type: 'Unconfined' },
                appArmorProfile: { type: 'Unconfined' },
              },
              volumeMounts: [
                {
                  name: 'buildkitd',
                  mountPath: '/home/user/.local/share/buildkit',
                },
              ],
            },
          ],
          volumes: [{ name: 'buildkitd', emptyDir: {} }],
        },
      },
    },
  };
};

/** The repository token, deleted with its Job. */
export const buildSecret = (
  input: BuildManifestInput,
  job: V1Job,
  token: string,
): V1Secret => ({
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: {
    name: input.name,
    namespace: input.namespace,
    labels: labels(input),
    ownerReferences: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        name: job.metadata!.name!,
        uid: job.metadata!.uid!,
      },
    ],
  },
  type: 'Opaque',
  stringData: { GIT_AUTH_TOKEN: token },
});

const NAMESPACE_LABEL = 'k8s:io.kubernetes.pod.namespace';

/**
 * Builds run code from the repository. They may reach DNS, the registry and
 * the internet, nothing else in the cluster, and nothing may reach them.
 */
export const buildPolicy = (namespace: string) => ({
  apiVersion: 'cilium.io/v2',
  kind: 'CiliumNetworkPolicy',
  metadata: { name: BUILD_POLICY_NAME, namespace },
  spec: {
    endpointSelector: { matchLabels: {} },
    enableDefaultDeny: { ingress: true, egress: true },
    ingress: [],
    egress: [
      {
        toEndpoints: [
          {
            matchLabels: {
              [NAMESPACE_LABEL]: 'kube-system',
              'k8s-app': 'kube-dns',
            },
          },
        ],
        toPorts: [
          {
            ports: [
              { port: '53', protocol: 'UDP' },
              { port: '53', protocol: 'TCP' },
            ],
          },
        ],
      },
      {
        toEndpoints: [
          {
            matchLabels: {
              // `registry.<namespace>.svc…` from BUILD_REGISTRY.
              [NAMESPACE_LABEL]: buildRegistry().split('.')[1],
              'app.kubernetes.io/name': 'registry',
            },
          },
        ],
        toPorts: [{ ports: [{ port: '5000', protocol: 'TCP' }] }],
      },
      { toEntities: ['world'] },
    ],
  },
});
