import type { V1Container, V1Probe, V1Secret } from '@kubernetes/client-node';
import { projectNamespace } from '@/common/naming';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  PROJECT_ID_LABEL,
  WORKLOAD_NAME_ANNOTATION,
  type WorkloadManifestInput,
} from '../docker/docker-workload.manifests';
import type { BucketKeys } from '../s3-bucket/s3-bucket.manifests';

/** Serves files from a folder; `/static-web-server` is its entrypoint. */
export const STATIC_SERVER_IMAGE = 'joseluisq/static-web-server:2.44.1';
/** The server's default port, which domains of a static site target. */
export const STATIC_SERVER_PORT = 80;
export const SITE_MOUNT_PATH = '/site';
/**
 * Not `acceleratio.io/workload-id`: the Docker service prunes Secrets and
 * claims of its workload by that label.
 */
export const SITE_KEY_LABEL = 'acceleratio.io/static-site-id';

/** Key prefix of a site in the sites bucket: every release, one folder each. */
export const sitePrefix = (workloadId: string): string => `${workloadId}/`;

export const releaseKeyPrefix = (
  workloadId: string,
  releaseId: string,
): string => `${sitePrefix(workloadId)}${releaseId}/`;

/** The site's read-only key to its own prefix, in the project namespace. */
export const siteKeySecretName = (workloadId: string): string =>
  `static-site-${workloadId}`;

/**
 * Arguments of the server: serve one release, with its own 404 page. The
 * server hides dot-paths by default; hidden files never reach a release (see
 * `isServedPath`), so turning that off only lets `.well-known/` through.
 */
export const siteServerArgs = (releaseId: string): string[] => [
  '--root',
  `${SITE_MOUNT_PATH}/${releaseId}`,
  '--page404',
  `${SITE_MOUNT_PATH}/${releaseId}/404.html`,
  '--ignore-hidden-files',
  'false',
];

/**
 * A new pod takes traffic only once `/` answers. Its files are copied before
 * the server starts, so a rollout never sends visitors to a pod that cannot
 * serve the new release.
 */
export const SITE_READINESS_PROBE: V1Probe = {
  httpGet: { path: '/', port: STATIC_SERVER_PORT },
  periodSeconds: 2,
  failureThreshold: 3,
};

/**
 * Copies one release from the sites bucket into the pod before the server
 * starts, with the site's own read-only key. The bucket, workload and release
 * are validated names, and the keys come from the Secret.
 */
export const buildSiteFilesContainer = (input: {
  workloadId: string;
  releaseId: string;
  bucket: string;
  endpoint: string;
  image: string;
}): V1Container => ({
  name: 'fetch-files',
  image: input.image,
  imagePullPolicy: 'IfNotPresent',
  command: [
    'sh',
    '-ec',
    [
      'rc alias set site "$RUSTFS_ENDPOINT" "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" --bucket-lookup path >/dev/null',
      `rc mirror --quiet site/${input.bucket}/${releaseKeyPrefix(input.workloadId, input.releaseId)} ${SITE_MOUNT_PATH}/${input.releaseId}/`,
    ].join('\n'),
  ],
  env: [{ name: 'RUSTFS_ENDPOINT', value: input.endpoint }],
  envFrom: [{ secretRef: { name: siteKeySecretName(input.workloadId) } }],
  resources: {
    requests: { cpu: '50m', memory: '64Mi' },
    limits: { cpu: '500m', memory: '256Mi' },
  },
});

export const buildSiteKeySecret = (
  input: Pick<WorkloadManifestInput, 'id' | 'project_id' | 'name'>,
  keys: BucketKeys,
): V1Secret => ({
  apiVersion: 'v1',
  kind: 'Secret',
  metadata: {
    name: siteKeySecretName(input.id),
    namespace: projectNamespace(input.project_id),
    labels: {
      [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      [PROJECT_ID_LABEL]: input.project_id,
      [SITE_KEY_LABEL]: input.id,
    },
    annotations: { [WORKLOAD_NAME_ANNOTATION]: input.name },
  },
  type: 'Opaque',
  stringData: {
    AWS_ACCESS_KEY_ID: keys.accessKeyId,
    AWS_SECRET_ACCESS_KEY: keys.secretAccessKey,
  },
});
