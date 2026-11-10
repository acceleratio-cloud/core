import type {
  V1PersistentVolume,
  V1PersistentVolumeClaim,
} from '@kubernetes/client-node';
import { projectNamespace } from '@/common/naming';
import { SEAWEEDFS_PROVISIONER } from '@/application/storage-class/storage-class.manifests';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  PROJECT_ID_LABEL,
  WORKLOAD_ID_LABEL,
  WORKLOAD_NAME_ANNOTATION,
  type WorkloadManifestInput,
} from '../docker/docker-workload.manifests';

/** Serves files from a folder; `/static-web-server` is its entrypoint. */
export const STATIC_SERVER_IMAGE = 'joseluisq/static-web-server:2.44.1';
/** The server's default port, which domains of a static site target. */
export const STATIC_SERVER_PORT = 80;
export const SITE_MOUNT_PATH = '/site';
/**
 * The volume is read-only, so the size is nominal: the CSI driver wants one,
 * and nothing is written through the mount.
 */
const SITE_VOLUME_SIZE = '100Gi';
const SITE_ACCESS_MODE = 'ReadWriteMany';

/** Filer folder with every release of a site, one subfolder each. */
export const sitesRoot = (workloadId: string): string => `/sites/${workloadId}`;

export const releasePath = (workloadId: string, releaseId: string): string =>
  `${sitesRoot(workloadId)}/${releaseId}`;

/** Name of both the PersistentVolume and its claim. */
export const siteVolumeName = (workloadId: string): string =>
  `static-site-${workloadId}`;

/**
 * Arguments of the server: serve one release, with its own 404 page. Hidden
 * files (`.env`, `.git/`) answer 404, since a picked folder may hold them.
 */
export const siteServerArgs = (releaseId: string): string[] => [
  '--root',
  `${SITE_MOUNT_PATH}/${releaseId}`,
  '--page404',
  `${SITE_MOUNT_PATH}/${releaseId}/404.html`,
  '--ignore-hidden-files',
  'true',
];

type SiteInput = Pick<WorkloadManifestInput, 'id' | 'project_id' | 'name'>;

const siteMetadata = (input: SiteInput) => ({
  name: siteVolumeName(input.id),
  labels: {
    [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
    [PROJECT_ID_LABEL]: input.project_id,
    [WORKLOAD_ID_LABEL]: input.id,
  },
  annotations: { [WORKLOAD_NAME_ANNOTATION]: input.name },
});

/**
 * A statically provisioned SeaweedFS volume over the site's filer folder
 * (the driver mounts `volumeAttributes.path`). It is bound to the site's claim
 * up front, so no other claim can take it, and kept on release: the API
 * deletes the files itself.
 */
export const buildSiteVolume = (input: SiteInput): V1PersistentVolume => ({
  apiVersion: 'v1',
  kind: 'PersistentVolume',
  metadata: siteMetadata(input),
  spec: {
    capacity: { storage: SITE_VOLUME_SIZE },
    accessModes: [SITE_ACCESS_MODE],
    persistentVolumeReclaimPolicy: 'Retain',
    storageClassName: '',
    claimRef: {
      namespace: projectNamespace(input.project_id),
      name: siteVolumeName(input.id),
    },
    csi: {
      driver: SEAWEEDFS_PROVISIONER,
      volumeHandle: siteVolumeName(input.id),
      readOnly: true,
      volumeAttributes: { path: sitesRoot(input.id) },
    },
  },
});

/**
 * The claim the pods mount. It has no volume id label, so the Docker
 * service's claim prune never takes it for a dropped volume.
 */
export const buildSiteClaim = (input: SiteInput): V1PersistentVolumeClaim => ({
  apiVersion: 'v1',
  kind: 'PersistentVolumeClaim',
  metadata: {
    ...siteMetadata(input),
    namespace: projectNamespace(input.project_id),
  },
  spec: {
    accessModes: [SITE_ACCESS_MODE],
    storageClassName: '',
    volumeName: siteVolumeName(input.id),
    resources: { requests: { storage: SITE_VOLUME_SIZE } },
  },
});
