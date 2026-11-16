import {
  VULNERABILITY_SEVERITIES,
  type RecommendationKind,
  type RecommendationLevel,
  type RecommendedPackage,
  type SecurityRecommendation,
  type ServiceSecurity,
  type Vulnerability,
  type VulnerabilityCounts,
  type WorkloadType,
} from '@acceleratio/shared';

/** What the API knows about one service, for deciding what to recommend. */
export interface ServiceFacts {
  workload_id: string;
  type: WorkloadType;
  /** A routed domain or a database port open to the internet. */
  public: boolean;
  /** How a GitHub service was built; null for other types. */
  builder: 'dockerfile' | 'railpack' | null;
  /** A PostgreSQL port open to every address. */
  open_to_everyone: boolean;
  images: {
    image: string;
    managed: boolean;
    /** Null while the image has not been scanned yet. */
    vulnerabilities: Vulnerability[] | null;
    /**
     * The newest release of the image's line, for an image a Docker service
     * names: `none` when there is none, `unknown` when nobody looked yet or
     * the registry could not be read.
     */
    release?:
      | { status: 'unknown' }
      | { status: 'none' }
      | {
          status: 'found';
          tag: string;
          image: string;
          /** Null while the release has not been scanned yet. */
          vulnerabilities: Vulnerability[] | null;
        };
  }[];
}

const MAX_PACKAGES = 5;
const LEVEL_RANK: Record<RecommendationLevel, number> = {
  urgent: 0,
  recommended: 1,
  optional: 2,
};

const tally = (items: Vulnerability[]): VulnerabilityCounts => {
  const counts = Object.fromEntries(
    VULNERABILITY_SEVERITIES.map((severity) => [severity, 0]),
  ) as VulnerabilityCounts;

  for (const item of items) {
    counts[item.severity] += 1;
  }

  return counts;
};

/**
 * The packages to raise, each once: exploited ones first, then by severity
 * (the list is sorted).
 */
const packagesOf = (items: Vulnerability[]): RecommendedPackage[] => {
  const seen = new Map<string, RecommendedPackage>();
  const ordered = [
    ...items.filter((item) => item.exploited),
    ...items.filter((item) => !item.exploited),
  ];

  for (const item of ordered) {
    if (item.fixed_version && !seen.has(item.package)) {
      seen.set(item.package, {
        name: item.package,
        installed_version: item.installed_version,
        fixed_version: item.fixed_version,
      });
    }
  }

  return [...seen.values()].slice(0, MAX_PACKAGES);
};

/**
 * A fix for something exploited in the wild, or for a critical finding on a
 * public service, is urgent; critical or high otherwise is recommended; the
 * rest can wait.
 */
const levelOf = (
  items: Vulnerability[],
  isPublic: boolean,
): RecommendationLevel => {
  const counts = tally(items);

  return items.some((item) => item.exploited) ||
    (counts.critical > 0 && isPublic)
    ? 'urgent'
    : counts.critical + counts.high > 0
      ? 'recommended'
      : 'optional';
};

/** The same advisory on the same package, across two images. */
const findingKey = (item: Vulnerability) => `${item.id}\0${item.package}`;

/** A tag that can point at other code tomorrow: none, or `latest`. */
export const isMovingTag = (image: string): boolean => {
  if (image.includes('@')) {
    return false;
  }

  const name = image.slice(image.lastIndexOf('/') + 1);
  const tag = name.includes(':') ? name.slice(name.indexOf(':') + 1) : '';

  return tag === '' || tag === 'latest';
};

/**
 * Sorts each service's findings by who can fix them: the user (a
 * recommendation), the platform (its images and the Railpack base image), or
 * nobody yet (no fixed version). The service's status follows from that.
 */
export const assessService = (
  facts: ServiceFacts,
): {
  service: ServiceSecurity;
  recommendations: SecurityRecommendation[];
  /** Every image has a finished scan. */
  scanned: boolean;
} => {
  // One recommendation per kind: a service running several digests (a
  // rollout, `latest` pulled at different times) gets their findings merged.
  const pending = new Map<
    RecommendationKind,
    {
      level: RecommendationLevel;
      image: string | null;
      items: Vulnerability[] | null;
      update: SecurityRecommendation['update'];
    }
  >();
  let platformFixable = 0;
  let waiting = 0;

  const recommend = (
    kind: RecommendationKind,
    level: RecommendationLevel,
    image: string | null,
    items: Vulnerability[] | null,
    update: SecurityRecommendation['update'] = null,
  ) => {
    const earlier = pending.get(kind);

    if (!earlier) {
      pending.set(kind, { level, image, items, update });
      return;
    }

    if (earlier.items && items) {
      const keys = new Set(earlier.items.map(findingKey));

      // packagesOf expects the most severe first.
      earlier.items = [
        ...earlier.items,
        ...items.filter((item) => !keys.has(findingKey(item))),
      ].sort(
        (a, b) =>
          VULNERABILITY_SEVERITIES.indexOf(a.severity) -
          VULNERABILITY_SEVERITIES.indexOf(b.severity),
      );
      earlier.level = levelOf(earlier.items, facts.public);
    }

    earlier.update ??= update;
  };

  for (const { image, managed, vulnerabilities, release } of facts.images) {
    if (!vulnerabilities) {
      continue;
    }

    const fixable = vulnerabilities.filter((item) => item.fixed_version);

    waiting += vulnerabilities.length - fixable.length;

    if (managed) {
      platformFixable += fixable.length;
      continue;
    }

    if (facts.type === 'github') {
      const libraries = fixable.filter((item) => item.kind !== 'os');
      const system = fixable.filter((item) => item.kind === 'os');

      if (libraries.length > 0) {
        recommend(
          'dependencies',
          levelOf(libraries, facts.public),
          image,
          libraries,
        );
      }

      // Railpack picks the base image; a newer Railpack in a platform update moves it.
      if (facts.builder === 'dockerfile' && system.length > 0) {
        recommend('base_image', levelOf(system, facts.public), image, system);
      } else {
        platformFixable += system.length;
      }

      continue;
    }

    if (fixable.length === 0) {
      continue;
    }

    if (release?.status === 'none') {
      // No newer release of this line: nothing for the user to do yet.
      waiting += fixable.length;
      continue;
    }

    if (release?.status === 'found' && release.vulnerabilities) {
      const after = new Set(release.vulnerabilities.map(findingKey));
      const closed = vulnerabilities.filter(
        (item) => !after.has(findingKey(item)),
      );

      if (closed.length === 0) {
        // The newest release still has them all.
        waiting += fixable.length;
        continue;
      }

      // What the release closes is fixed by updating, whether or not the
      // scanner knew a fixed package version.
      waiting -= closed.filter((item) => !item.fixed_version).length;
      waiting +=
        fixable.length - closed.filter((item) => item.fixed_version).length;
      recommend('image_update', levelOf(closed, facts.public), image, closed, {
        tag: release.tag,
        image: release.image,
        remaining: tally(release.vulnerabilities),
      });
      continue;
    }

    recommend(
      'image_update',
      levelOf(fixable, facts.public),
      image,
      fixable,
      release?.status === 'found'
        ? { tag: release.tag, image: release.image, remaining: null }
        : null,
    );
  }

  if (facts.open_to_everyone) {
    recommend('database_exposed', 'urgent', null, null);
  }

  if (facts.type === 'docker') {
    const moving = facts.images.find(
      (item) => !item.managed && isMovingTag(item.image),
    );

    if (moving) {
      recommend('moving_tag', 'optional', moving.image, null);
    }
  }

  const scanned = facts.images.every((item) => item.vulnerabilities);
  const recommendations = [...pending].map(
    ([kind, { level, image, items, update }]): SecurityRecommendation => ({
      id: `${kind}:${facts.workload_id}`,
      workload_id: facts.workload_id,
      kind,
      level,
      image,
      fixes: items ? tally(items) : null,
      packages: items ? packagesOf(items) : [],
      exploited: items ? items.filter((item) => item.exploited).length : 0,
      is_new: false,
      update,
    }),
  );

  return {
    service: {
      workload_id: facts.workload_id,
      status: statusOf(recommendations, platformFixable, waiting, scanned),
      public: facts.public,
      platform_fixable: platformFixable,
      waiting,
    },
    recommendations,
    scanned,
  };
};

/** The service's status from what is left for the user, the platform and nobody. */
export const statusOf = (
  recommendations: SecurityRecommendation[],
  platformFixable: number,
  waiting: number,
  scanned: boolean,
): ServiceSecurity['status'] =>
  recommendations.some((item) => item.level === 'urgent')
    ? 'action'
    : recommendations.length > 0
      ? 'update'
      : !scanned
        ? 'pending'
        : platformFixable > 0
          ? 'platform'
          : waiting > 0
            ? 'waiting'
            : 'ok';

/** Most urgent first, then the ones that close the most severe findings. */
export const sortRecommendations = (
  items: SecurityRecommendation[],
): SecurityRecommendation[] =>
  [...items].sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      b.exploited - a.exploited ||
      (b.fixes?.critical ?? 0) - (a.fixes?.critical ?? 0) ||
      (b.fixes?.high ?? 0) - (a.fixes?.high ?? 0) ||
      a.id.localeCompare(b.id),
  );
