/**
 * Naming rules for objects that live outside the platform.
 *
 * Kubernetes names are DNS-1123 labels: lowercase alphanumerics and '-', they
 * must start and end with an alphanumeric and be at most 63 characters. Every
 * function in this file returns such a label.
 *
 * - `projectNamespace(projectId)` returns `project-<projectId>`. A UUID gives
 *   44 characters. The id is lowercased because labels cannot contain upper
 *   case; any other invalid character makes the function throw instead of
 *   silently producing a different namespace.
 * - `slugify(name)` lowercases the name, transliterates Cyrillic, strips
 *   Latin diacritics and replaces every run of other characters with a single
 *   '-'. Leading and trailing dashes are removed. A name with no usable
 *   characters (empty, punctuation only, emoji only) becomes `workload`, so
 *   the result is deterministic and never blank. The result is truncated to
 *   the 63 characters a label allows.
 * - `workloadExternalName(name, id)` returns `<slug>-<id prefix>`. The name is
 *   kept in DNS-1035 shape, which requires a leading letter, because a Docker
 *   service with domains gets a Kubernetes Service of the same name. A slug
 *   that starts with a digit therefore gets a `w-` marker (`2048` becomes
 *   `w-2048-<id>`); names that already start with a letter keep their shape,
 *   and existing names stay stable. The slug is truncated to 40 characters by
 *   default and the id prefix is 8 characters, which keeps the name inside the
 *   63-character limit (a numeric-leading name uses 2 + 40 + 1 + 8 = 51). The
 *   name is generated once at creation and never changes, so renaming a
 *   workload does not break Deployment selectors or DNS labels. A collision
 *   on `(project_id, external_name)` is retried with a 12-character id prefix.
 * - `internalHostname(name, attempt)` returns the private DNS label of a
 *   Docker service: the slug in DNS-1035 shape (the same `w-` marker), cut to
 *   `INTERNAL_HOSTNAME_MAX_LENGTH`, with `-<attempt>` from the second attempt
 *   on (`postgres`, `postgres-2`). It names the service's headless Service, and
 *   `internalDomain(label)` is the name other services use: `<label>.internal`.
 */

export const DNS1123_LABEL_MAX_LENGTH = 63;
export const DEFAULT_SLUG_LENGTH = 40;
export const DEFAULT_ID_PREFIX_LENGTH = 8;
export const CONFLICT_ID_PREFIX_LENGTH = 12;
export const EMPTY_SLUG = 'workload';

const NUMERIC_SLUG_PREFIX = 'w-';

const DNS1123_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const TRANSLITERATION: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ї: 'i',
  є: 'ye',
  ґ: 'g',
  ў: 'u',
};

const toSingleDashes = (value: string): string =>
  value.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const truncateLabel = (value: string, length: number): string => {
  const truncated = value.slice(0, length).replace(/-+$/, '');

  return truncated || EMPTY_SLUG.slice(0, length);
};

const toPositiveLength = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(value));
};

export const slugify = (name: string): string => {
  const transliterated = Array.from(name.toLowerCase())
    .map((character) => TRANSLITERATION[character] ?? character)
    .join('')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '');
  const slug = toSingleDashes(transliterated);

  return truncateLabel(slug, DNS1123_LABEL_MAX_LENGTH);
};

export const projectNamespace = (projectId: string): string => {
  const namespace = `project-${projectId.toLowerCase()}`;

  if (
    namespace.length > DNS1123_LABEL_MAX_LENGTH ||
    !DNS1123_LABEL.test(namespace)
  ) {
    throw new Error('Project id is not a valid DNS-1123 label');
  }

  return namespace;
};

export const workloadExternalName = (
  name: string,
  id: string,
  slugLength: number = DEFAULT_SLUG_LENGTH,
  idPrefixLength: number = DEFAULT_ID_PREFIX_LENGTH,
): string => {
  const slug = slugify(name);
  // Keep the name in DNS-1035 shape, which requires a leading letter. The
  // marker is decided from the untruncated slug; truncation only shortens it,
  // so the first character cannot change.
  const marker = /^[0-9]/.test(slug) ? NUMERIC_SLUG_PREFIX : '';
  const suffixLength = Math.max(
    1,
    Math.min(
      toPositiveLength(idPrefixLength, DEFAULT_ID_PREFIX_LENGTH),
      DNS1123_LABEL_MAX_LENGTH - marker.length - 2,
    ),
  );
  const availableSlugLength = Math.max(
    1,
    Math.min(
      toPositiveLength(slugLength, DEFAULT_SLUG_LENGTH),
      DNS1123_LABEL_MAX_LENGTH - marker.length - suffixLength - 1,
    ),
  );
  const truncatedSlug = truncateLabel(slug, availableSlugLength);
  const prefix = toSingleDashes(id.toLowerCase())
    .replace(/-/g, '')
    .slice(0, suffixLength);
  const suffix = prefix || '0';

  return `${marker}${truncatedSlug}-${suffix}`;
};

const STORAGE_CLASS_PREFIX = 'sc-';

/**
 * StorageClass name for a console-created class: `sc-<slug>-<id prefix>`.
 * The `sc-` prefix keeps custom classes apart from installer-managed ones
 * (the platform class is `longhorn`). The slug is truncated to 40
 * characters, so the longest name is 3 + 40 + 1 + 12 = 56 characters. Like
 * workload names it is generated once and never follows a rename; a name
 * with no usable characters gets the `workload` slug from `slugify`.
 */
export const storageClassExternalName = (
  name: string,
  id: string,
  idPrefixLength: number = DEFAULT_ID_PREFIX_LENGTH,
): string => {
  const slug = truncateLabel(slugify(name), DEFAULT_SLUG_LENGTH);
  const suffix =
    id
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, toPositiveLength(idPrefixLength, DEFAULT_ID_PREFIX_LENGTH)) ||
    '0';

  return `${STORAGE_CLASS_PREFIX}${slug}-${suffix}`;
};

/** Leaves room for a `-<n>` suffix inside the 63-character label. */
export const INTERNAL_HOSTNAME_MAX_LENGTH = 50;
export const INTERNAL_DNS_SUFFIX = 'internal';

const DNS1035_LABEL = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;

export const isInternalHostname = (value: string): boolean =>
  value.length <= INTERNAL_HOSTNAME_MAX_LENGTH && DNS1035_LABEL.test(value);

export const internalHostname = (name: string, attempt = 1): string => {
  const slug = slugify(name);
  const marker = /^[0-9]/.test(slug) ? NUMERIC_SLUG_PREFIX : '';
  const base = truncateLabel(
    slug,
    INTERNAL_HOSTNAME_MAX_LENGTH - marker.length,
  );

  return attempt > 1
    ? `${marker}${base}-${Math.trunc(attempt)}`
    : `${marker}${base}`;
};

export const internalDomain = (hostname: string): string =>
  `${hostname}.${INTERNAL_DNS_SUFFIX}`;
