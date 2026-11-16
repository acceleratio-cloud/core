import { Injectable } from '@nestjs/common';

/** `docker.io/library/nginx:1.25` taken apart; `tag` is null for a digest. */
export interface ImageReference {
  /** Host to call: `registry-1.docker.io` for Docker Hub. */
  host: string;
  /** As people write it: `docker.io`, `ghcr.io`. */
  registry: string;
  repository: string;
  tag: string | null;
}

const DOCKER_HUB = 'docker.io';
const DOCKER_HUB_HOST = 'registry-1.docker.io';
const HUB_API = 'https://hub.docker.com/v2/repositories';
const HUB_PAGE_SIZE = 100;
/** The newest 500 tags that match: releases of a line are recent ones. */
const HUB_PAGES = 5;
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 1000;
/** Repositories with more tags than this are read only this far. */
const MAX_PAGES = 20;
const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/**
 * Splits an image as a pod spec names it. A first part with a dot, a colon or
 * `localhost` is a registry; otherwise it is Docker Hub, where one-part names
 * live under `library/`.
 */
export const parseImageReference = (image: string): ImageReference | null => {
  const [name, digest] = image.split('@');

  if (!name || /\s/.test(image)) {
    return null;
  }

  const slash = name.indexOf('/');
  const first = slash === -1 ? '' : name.slice(0, slash);
  const hasRegistry =
    first.includes('.') || first.includes(':') || first === 'localhost';
  const registry = hasRegistry ? first : DOCKER_HUB;
  let path = hasRegistry ? name.slice(slash + 1) : name;
  const colon = path.lastIndexOf(':');
  const tag = colon === -1 || digest ? null : path.slice(colon + 1);

  if (colon !== -1) {
    path = path.slice(0, colon);
  }

  if (registry === DOCKER_HUB && !path.includes('/')) {
    path = `library/${path}`;
  }

  if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(path)) {
    return null;
  }

  return {
    host: registry === DOCKER_HUB ? DOCKER_HUB_HOST : registry,
    registry,
    repository: path,
    tag: tag || (digest ? null : 'latest'),
  };
};

/** `realm="…",service="…",scope="…"` of a Bearer challenge. */
const challengeOf = (header: string | null): Record<string, string> | null => {
  if (!header?.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return Object.fromEntries(
    [...header.slice(7).matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [
      key,
      value,
    ]),
  );
};

/**
 * Reads public repositories of any OCI registry anonymously: the Bearer token
 * flow of Docker Hub, GHCR and Quay, or none when the registry asks for none.
 * Listing tags and asking for a digest with HEAD do not count as pulls on
 * Docker Hub.
 */
@Injectable()
export class OciRegistryClient {
  /**
   * Tags of the repository. Docker Hub lists them through its own API,
   * newest first and narrowed to names containing `hint` (such as `2.`), since
   * the registry lists them alphabetically, tens of thousands for some
   * images. Other registries list them through the registry API.
   */
  async listTags(reference: ImageReference, hint = ''): Promise<string[]> {
    return reference.registry === DOCKER_HUB
      ? this.listHubTags(reference, hint)
      : this.listRegistryTags(reference);
  }

  private async listHubTags(
    reference: ImageReference,
    hint: string,
  ): Promise<string[]> {
    const tags: string[] = [];
    const url = new URL(`${HUB_API}/${reference.repository}/tags`);

    url.searchParams.set('page_size', String(HUB_PAGE_SIZE));
    url.searchParams.set('ordering', 'last_updated');
    if (hint) {
      url.searchParams.set('name', hint);
    }

    let next: string | null = url.toString();

    for (let page = 0; next && page < HUB_PAGES; page += 1) {
      const response = await fetch(next, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Docker Hub answered HTTP ${response.status}`);
      }

      const body = (await response.json()) as {
        results?: { name?: unknown }[];
        next?: unknown;
      };

      tags.push(
        ...(body.results ?? [])
          .map((item) => item.name)
          .filter((name): name is string => typeof name === 'string'),
      );
      next =
        typeof body.next === 'string' && body.next.startsWith(HUB_API)
          ? body.next
          : null;
    }

    return tags;
  }

  private async listRegistryTags(reference: ImageReference): Promise<string[]> {
    const tags: string[] = [];
    let path: string | null =
      `/v2/${reference.repository}/tags/list?n=${PAGE_SIZE}`;
    let token: string | null = null;

    for (let page = 0; path && page < MAX_PAGES; page += 1) {
      const result = await this.request(reference, path, 'GET', token);
      token = result.token;

      const body = (await result.response.json()) as { tags?: unknown };

      tags.push(
        ...(Array.isArray(body.tags)
          ? body.tags.filter((tag): tag is string => typeof tag === 'string')
          : []),
      );
      path =
        /<([^>]+)>;\s*rel="next"/.exec(
          result.response.headers.get('link') ?? '',
        )?.[1] ?? null;
    }

    return tags;
  }

  /** The digest a tag points at now, as nodes would pull it. */
  async digestOf(reference: ImageReference, tag: string): Promise<string> {
    const { response } = await this.request(
      reference,
      `/v2/${reference.repository}/manifests/${encodeURIComponent(tag)}`,
      'HEAD',
      null,
    );
    const digest = response.headers.get('docker-content-digest') ?? '';

    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`${reference.registry} gave no digest for ${tag}`);
    }

    return digest;
  }

  private async request(
    reference: ImageReference,
    path: string,
    method: 'GET' | 'HEAD',
    token: string | null,
  ): Promise<{ response: Response; token: string | null }> {
    const url = new URL(path, `https://${reference.host}`);
    const call = (bearer: string | null) =>
      fetch(url, {
        method,
        headers: {
          Accept: MANIFEST_TYPES,
          ...(bearer && { Authorization: `Bearer ${bearer}` }),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

    let response = await call(token);

    if (response.status === 401) {
      const challenge = challengeOf(response.headers.get('www-authenticate'));

      if (!challenge?.realm) {
        throw new Error(`${reference.registry} asks for credentials`);
      }

      token = await this.anonymousToken(challenge, reference.repository);
      response = await call(token);
    }

    if (!response.ok) {
      throw new Error(`${reference.registry} answered HTTP ${response.status}`);
    }

    return { response, token };
  }

  private async anonymousToken(
    challenge: Record<string, string>,
    repository: string,
  ): Promise<string> {
    const url = new URL(challenge.realm);

    if (url.protocol !== 'https:') {
      throw new Error('The registry asks for a token over plain HTTP');
    }

    if (challenge.service) {
      url.searchParams.set('service', challenge.service);
    }
    url.searchParams.set(
      'scope',
      challenge.scope ?? `repository:${repository}:pull`,
    );

    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`The token service answered HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      token?: unknown;
      access_token?: unknown;
    };
    const token = body.token ?? body.access_token;

    if (typeof token !== 'string' || !token) {
      throw new Error('The token service gave no token');
    }

    return token;
  }
}
