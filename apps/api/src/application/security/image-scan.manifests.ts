import type {
  V1Job,
  V1Namespace,
  V1PersistentVolumeClaim,
} from '@kubernetes/client-node';
import { buildRegistry, REGISTRY_PULL_HOST } from '@/common/registry';
import { parseQuantity } from '../metrics/metrics-query';
import { buildPolicy } from '../workload/github/github-build.manifests';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
} from '../workload/docker/docker-workload.manifests';

export const DEFAULT_SCAN_NAMESPACE = 'acceleratio-security';
/** Trivy pinned by index digest; override with SCANNER_IMAGE. */
export const DEFAULT_SCANNER_IMAGE =
  'aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb';
export const SCAN_CONTAINER = 'trivy';
export const SCAN_CACHE_CLAIM = 'trivy-cache';
/** The vulnerability database (~1 GB), the Java one when a JAR shows up (~2 GB) and layer results. */
export const SCAN_CACHE_SIZE = '10Gi';
export const DEFAULT_SCAN_MEMORY_LIMIT = '1Gi';
export const DEFAULT_SCAN_TIMEOUT_MINUTES = 20;
const MIN_SCAN_MEMORY = 256 * 1024 * 1024;
/** Go's heap target under the limit, so a large image slows down before it is killed. */
const GO_MEMORY_SHARE = 0.85;
export const SCAN_POLICY_NAME = 'acceleratio-scan-isolation';
export const SCAN_ID_LABEL = 'acceleratio.io/scan-id';

export const scanNamespace = (): string =>
  process.env.SCAN_NAMESPACE?.trim() || DEFAULT_SCAN_NAMESPACE;

export const scannerImage = (): string =>
  process.env.SCANNER_IMAGE?.trim() || DEFAULT_SCANNER_IMAGE;

/** SCAN_MEMORY_LIMIT, a Kubernetes quantity of at least 256Mi; the default otherwise. */
export const scanMemoryLimit = (): { quantity: string; bytes: number } => {
  const quantity = process.env.SCAN_MEMORY_LIMIT?.trim() ?? '';
  const bytes = parseQuantity(quantity);

  return bytes !== null && bytes >= MIN_SCAN_MEMORY
    ? { quantity, bytes }
    : {
        quantity: DEFAULT_SCAN_MEMORY_LIMIT,
        bytes: parseQuantity(DEFAULT_SCAN_MEMORY_LIMIT) ?? MIN_SCAN_MEMORY * 4,
      };
};

/**
 * SCAN_TIMEOUT_MINUTES (1 to 180) in seconds: the Job is killed after it,
 * and the API gives up a little later.
 */
export const scanTimeoutSeconds = (): number => {
  const minutes = Number(process.env.SCAN_TIMEOUT_MINUTES?.trim());

  return (
    (Number.isInteger(minutes) && minutes >= 1 && minutes <= 180
      ? minutes
      : DEFAULT_SCAN_TIMEOUT_MINUTES) * 60
  );
};

/**
 * Where SBOMs live on the cache volume, per scanner version: a new scanner
 * builds them again once, with its own analysers.
 */
export const sbomDir = (): string => {
  const tag = scannerImage().split('@')[0].split(':')[1] ?? '';

  return `/cache/sbom/${/^[a-z0-9.-]+$/i.test(tag) ? tag : 'custom'}`;
};

export const scanJobName = (scanId: string): string =>
  `scan-${scanId.replace(/-/g, '').slice(0, 16)}`;

const IMAGE_ID = /^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$/;

/**
 * What the scanner pulls for a pod's `imageID`. Images built from GitHub are
 * pulled by nodes as `REGISTRY_PULL_HOST`, a name pods cannot resolve, so the
 * scanner uses the registry's cluster DNS name instead, over plain HTTP.
 * Null for anything that is not `<repository>@sha256:<digest>`.
 */
export const scanTarget = (
  imageId: string,
): { ref: string; insecure: boolean } | null => {
  const ref = imageId.replace(/^docker-pullable:\/\//, '');

  if (!IMAGE_ID.test(ref)) {
    return null;
  }

  if (ref.startsWith(`${REGISTRY_PULL_HOST}/`)) {
    return {
      ref: `${buildRegistry()}/${ref.slice(REGISTRY_PULL_HOST.length + 1)}`,
      insecure: true,
    };
  }

  return { ref, insecure: false };
};

/** One JSON object per vulnerability, read back by `parseScanOutput`. */
export const SCAN_TEMPLATE =
  '{{- range . }}{{- $class := .Class }}{{- $type := .Type }}{{- range .Vulnerabilities }}' +
  '{{ dict "id" .VulnerabilityID "severity" .Severity "pkg" .PkgName "installed" .InstalledVersion "fixed" .FixedVersion "title" .Title "class" $class "type" $type | toJson }}\n' +
  '{{ end }}{{- end }}';

/**
 * The image is pulled and taken apart once per digest, into a CycloneDX SBOM
 * kept on the cache volume. Every scan, the first and each daily one, matches
 * that SBOM against the current database, so rescans never reach the image's
 * registry. SBOMs unused for two weeks are deleted.
 */
export const scanScript = (): string =>
  [
    'set -eu',
    `sbom="$SBOM_DIR/$(printf %s "$SCAN_DIGEST" | tr : -).cdx.json"`,
    'mkdir -p "$SBOM_DIR"',
    'if [ ! -s "$sbom" ]; then',
    '  trivy image --cache-dir=/cache --format=cyclonedx --parallel=1 --quiet --skip-version-check --timeout="$SCAN_TIMEOUT" --output="$sbom.partial" "$SCAN_IMAGE"',
    '  mv "$sbom.partial" "$sbom"',
    'fi',
    'touch "$sbom"',
    "find /cache/sbom -name '*.cdx.json*' -mtime +14 -delete 2>/dev/null || true",
    'exec trivy sbom --cache-dir=/cache --scanners=vuln --format=template --template="$SCAN_TEMPLATE" --quiet --skip-version-check --timeout="$SCAN_TIMEOUT" "$sbom"',
  ].join('\n');

const labels = (scanId: string) => ({
  [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
  [SCAN_ID_LABEL]: scanId,
});

export const scanNamespaceManifest = (name: string): V1Namespace => ({
  apiVersion: 'v1',
  kind: 'Namespace',
  metadata: { name, labels: { [MANAGED_BY_LABEL]: MANAGED_BY_VALUE } },
});

/** On the default StorageClass; attached only while a scan runs. */
export const scanCacheClaim = (namespace: string): V1PersistentVolumeClaim => ({
  apiVersion: 'v1',
  kind: 'PersistentVolumeClaim',
  metadata: {
    name: SCAN_CACHE_CLAIM,
    namespace,
    labels: { [MANAGED_BY_LABEL]: MANAGED_BY_VALUE },
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: { requests: { storage: SCAN_CACHE_SIZE } },
  },
});

/**
 * Scans pull images that any user deployed: like builds, they may reach DNS,
 * the registry and the internet, nothing else in the cluster.
 */
export const scanPolicy = (namespace: string) => ({
  ...buildPolicy(namespace),
  metadata: { name: SCAN_POLICY_NAME, namespace },
});

export interface ScanJobInput {
  scanId: string;
  name: string;
  namespace: string;
  /** `sha256:…`, names the SBOM. */
  digest: string;
  ref: string;
  insecure: boolean;
}

export const scanJob = (input: ScanJobInput): V1Job => {
  const memory = scanMemoryLimit();
  const deadline = scanTimeoutSeconds();

  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: input.name,
      namespace: input.namespace,
      labels: labels(input.scanId),
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: deadline,
      // The API stores the result when the scan ends; this is the fallback.
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels: labels(input.scanId) },
        spec: {
          restartPolicy: 'Never',
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          securityContext: {
            runAsUser: 65534,
            runAsGroup: 65534,
            fsGroup: 65534,
            runAsNonRoot: true,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          containers: [
            {
              name: SCAN_CONTAINER,
              image: scannerImage(),
              command: ['sh', '-c', scanScript()],
              env: [
                { name: 'HOME', value: '/tmp' },
                { name: 'SCAN_IMAGE', value: input.ref },
                { name: 'SCAN_DIGEST', value: input.digest },
                { name: 'SBOM_DIR', value: sbomDir() },
                { name: 'SCAN_TEMPLATE', value: SCAN_TEMPLATE },
                { name: 'SCAN_TIMEOUT', value: `${deadline - 60}s` },
                { name: 'TRIVY_INSECURE', value: String(input.insecure) },
                {
                  name: 'GOMEMLIMIT',
                  value: String(Math.floor(memory.bytes * GO_MEMORY_SHARE)),
                },
              ],
              resources: {
                requests: { cpu: '100m', memory: '256Mi' },
                limits: { memory: memory.quantity },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ['ALL'] },
              },
              volumeMounts: [
                { name: 'cache', mountPath: '/cache' },
                { name: 'tmp', mountPath: '/tmp' },
              ],
            },
          ],
          volumes: [
            {
              name: 'cache',
              persistentVolumeClaim: { claimName: SCAN_CACHE_CLAIM },
            },
            // Large files of the image are unpacked here while it is analysed.
            { name: 'tmp', emptyDir: { sizeLimit: '10Gi' } },
          ],
        },
      },
    },
  };
};
