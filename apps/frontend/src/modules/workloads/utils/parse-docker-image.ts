export type ParsedDockerImage = {
  /** Registry, path and repository without tag or digest. */
  repository: string;
  /** Explicit tag, or `latest` when the reference names none. */
  tag: string;
  /** `sha256:...` when the reference is pinned by digest. */
  digest: string | null;
};

/**
 * Splits `registry:5000/team/app:1.2@sha256:...` into its parts. A colon only
 * starts a tag when it comes after the last slash, otherwise it is a registry
 * port.
 */
export const parseDockerImage = (reference: string): ParsedDockerImage => {
  const digestIndex = reference.indexOf('@');
  const digest = digestIndex === -1 ? null : reference.slice(digestIndex + 1);
  const withoutDigest =
    digestIndex === -1 ? reference : reference.slice(0, digestIndex);

  const tagIndex = withoutDigest.lastIndexOf(':');
  const hasTag = tagIndex > withoutDigest.lastIndexOf('/');

  return {
    repository: hasTag ? withoutDigest.slice(0, tagIndex) : withoutDigest,
    tag: hasTag ? withoutDigest.slice(tagIndex + 1) : 'latest',
    digest,
  };
};
