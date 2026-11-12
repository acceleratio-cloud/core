export const MARKETPLACE_CATEGORIES = [
  "Analytics",
  "Automation",
  "AI",
  "Content",
  "Developer tools",
  "Observability",
  "Productivity",
  "Security",
] as const;

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

/**
 * One service a template creates: a container, or a managed PostgreSQL
 * database (`type: 'postgres'`, no image, its disk in `size_gib`).
 */
export interface MarketplaceService {
  name: string;
  type: 'docker' | 'postgres';
  /** Docker only; always carries an explicit tag other than `latest`. */
  image?: string;
  /** `data:image/svg+xml;base64,…`; render it in an `<img>`, never inline. */
  icon: string;
  port?: number;
  /** Exposed on the app's domain. At most one service per template. */
  public?: boolean;
  volumes?: { path: string; size_gib: number }[];
  /** Disk of a `postgres` service in GiB. */
  size_gib?: number;
}

/** A value the user fills in before deploying. */
export interface MarketplaceInput {
  name: string;
  label: string;
  placeholder?: string;
  /** Prefilled value. */
  default?: string;
  /** False when the field may stay empty. */
  required: boolean;
}

export interface MarketplaceApp {
  slug: string;
  name: string;
  /** `data:image/svg+xml;base64,…`; render it in an `<img>`, never inline. */
  icon: string;
  category: MarketplaceCategory;
  tagline: string;
  /** Paragraphs separated by a blank line. */
  description: string;
  features: string[];
  license: string;
  repository: string;
  website: string;
  resources: { cpu: number; memory_mib: number };
  inputs: MarketplaceInput[];
  services: MarketplaceService[];
}

/**
 * Deploys a template: into `project_id`, or into a new project called
 * `project_name` (exactly one of the two).
 */
export interface DeployMarketplaceAppPayload {
  project_id?: string;
  project_name?: string;
  /** Name of the main service; the others are `<name>-<service>`. */
  name: string;
  /** Values for the template's inputs, by input name. */
  inputs?: Record<string, string>;
}

export interface MarketplaceDeployment {
  project_id: string;
  /** Ids of the services created, in template order. */
  workload_ids: string[];
  /** `https://…` of the public service; null when the app has none. */
  url: string | null;
}
