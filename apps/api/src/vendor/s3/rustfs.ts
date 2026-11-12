export const DEFAULT_RUSTFS_NAMESPACE = 'rustfs';
export const DEFAULT_RUSTFS_ADMIN_SECRET = 'rustfs-root';
export const DEFAULT_RUSTFS_S3_ENDPOINT =
  'http://rustfs.rustfs.svc.cluster.local:9000';
/** RustFS accepts any region; this is what S3 clients default to. */
export const S3_REGION = 'us-east-1';

/** Where RustFS runs: its Secret, its Service and the `rc` Jobs. */
export const rustfsNamespace = (): string =>
  process.env.RUSTFS_NAMESPACE?.trim() || DEFAULT_RUSTFS_NAMESPACE;

/** The Secret with the admin keys, in `rustfsNamespace()`. */
export const rustfsAdminSecret = (): string =>
  process.env.RUSTFS_ADMIN_SECRET?.trim() || DEFAULT_RUSTFS_ADMIN_SECRET;

/** The S3 endpoint as pods in the cluster reach it. */
export const rustfsS3Endpoint = (): string =>
  process.env.RUSTFS_S3_ENDPOINT?.trim() || DEFAULT_RUSTFS_S3_ENDPOINT;

/**
 * The S3 endpoint as the API reaches it. In development the API runs outside
 * the cluster and goes through a port-forward: the API server's service proxy
 * rewrites the path, which breaks the SigV4 signature.
 */
export const rustfsApiEndpoint = (): string =>
  process.env.RUSTFS_S3_API_ENDPOINT?.trim() || rustfsS3Endpoint();

/** The platform bucket with every static site's files. */
export const sitesBucket = (): string =>
  process.env.SITES_BUCKET?.trim() || 'acceleratio-sites';
