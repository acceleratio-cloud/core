/** Severity as the scanner reports it, highest first. */
export const VULNERABILITY_SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
] as const;

export type VulnerabilitySeverity = (typeof VULNERABILITY_SEVERITIES)[number];

export type VulnerabilityCounts = Record<VulnerabilitySeverity, number>;

/** `os`: a package of the image's distribution; `library`: one the application depends on. */
export type VulnerabilityKind = 'os' | 'library';

/** One known vulnerability of a package in an image. */
export interface Vulnerability {
  /** CVE, GHSA or a distribution advisory id. */
  id: string;
  severity: VulnerabilitySeverity;
  package: string;
  installed_version: string;
  /** Null when no fixed version exists yet. */
  fixed_version: string | null;
  title: string | null;
  kind: VulnerabilityKind | null;
  /** Package type as the scanner names it: `debian`, `npm`, `gobinary`… */
  ecosystem: string | null;
  /** Listed by CISA as exploited in the wild; set on read, not stored. */
  exploited?: boolean;
}

/**
 * `pending` waits for its turn (one scan runs at a time across the cluster),
 * `scanning` runs now; a finished scan is rescanned daily while it is in use.
 */
export type ImageScanStatus = 'pending' | 'scanning' | 'succeeded' | 'failed';

/** A container image a service of the project runs, with its last scan. */
export interface ServiceImageScan {
  workload_id: string;
  container: string;
  /** The image as the service names it. */
  image: string;
  /** `sha256:…` of what the cluster pulled. */
  digest: string;
  /** Chosen by the platform (PostgreSQL, static sites) and updated with it. */
  managed: boolean;
  status: ImageScanStatus;
  status_message: string | null;
  scanned_at: string | null;
  /** Null until a scan succeeded. */
  counts: VulnerabilityCounts | null;
  /** Vulnerabilities that have a fixed version. */
  fixable: number | null;
}

/**
 * `action`: an urgent fix the user can apply; `update`: a fix without rush;
 * `platform`: fixes arrive with a platform update; `waiting`: no fix exists
 * yet; `ok`: nothing known; `pending`: not scanned yet.
 */
export type ServiceSecurityStatus =
  | 'action'
  | 'update'
  | 'platform'
  | 'waiting'
  | 'ok'
  | 'pending';

export interface ServiceSecurity {
  workload_id: string;
  status: ServiceSecurityStatus;
  /** Reachable from the internet: a routed domain or an open database port. */
  public: boolean;
  /** Findings with a fixed version that a platform update brings. */
  platform_fixable: number;
  /** Findings with no fixed version yet. */
  waiting: number;
}

export type RecommendationLevel = 'urgent' | 'recommended' | 'optional';

/**
 * `dependencies`: packages of the user's code; `base_image`: packages of the
 * image a Dockerfile starts from; `image_update`: packages of an image the
 * service names; `database_exposed`: a database port open to everyone;
 * `moving_tag`: an image named by a tag that can change.
 */
export type RecommendationKind =
  | 'dependencies'
  | 'base_image'
  | 'image_update'
  | 'database_exposed'
  | 'moving_tag';

export interface RecommendedPackage {
  name: string;
  installed_version: string;
  fixed_version: string;
}

/** The newest release of the image's line, for an `image_update`. */
export interface ImageUpdate {
  tag: string;
  /** The image with the new tag, as the service would name it. */
  image: string;
  /** What is left after updating; null while the release is being scanned. */
  remaining: VulnerabilityCounts | null;
}

export interface SecurityRecommendation {
  /** `<kind>:<workload id>`, stable across scans. */
  id: string;
  workload_id: string;
  kind: RecommendationKind;
  level: RecommendationLevel;
  /** The image it is about, when it is about one. */
  image: string | null;
  /**
   * Findings the fix closes, per severity; null for setting checks. With a
   * scanned `update`, what that release no longer has.
   */
  fixes: VulnerabilityCounts | null;
  /** For `image_update`: the release to move to, once one is known. */
  update: ImageUpdate | null;
  /** The most severe packages to raise, at most five. */
  packages: RecommendedPackage[];
  /** Findings it closes that CISA lists as exploited in the wild. */
  exploited: number;
  /** First given within the last week, after the project's first ones. */
  is_new: boolean;
}

/** How long a risk can be accepted for. */
export const ACCEPT_RISK_DAYS = [30, 90, 180] as const;

export interface AcceptRiskPayload {
  recommendation_id: string;
  /** Why it is acceptable, 1 to 500 characters. */
  reason: string;
  days: (typeof ACCEPT_RISK_DAYS)[number];
}

/** A recommendation the user chose to leave alone for now. */
export interface AcceptedRisk {
  recommendation: SecurityRecommendation;
  reason: string;
  accepted_by: string | null;
  accepted_at: string;
  expires_at: string;
}

export interface ProjectSecurity {
  images: ServiceImageScan[];
  services: ServiceSecurity[];
  /** Most urgent first, without the accepted ones. */
  recommendations: SecurityRecommendation[];
  accepted: AcceptedRisk[];
}

export interface ImageVulnerabilities {
  digest: string;
  /** Highest severity first, at most `MAX_LISTED_VULNERABILITIES`. */
  vulnerabilities: Vulnerability[];
  /** Every vulnerability found, also those beyond the list. */
  total: number;
}

export const MAX_LISTED_VULNERABILITIES = 2000;
