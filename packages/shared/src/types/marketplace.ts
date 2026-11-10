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

/** One container a template creates. */
export interface MarketplaceService {
  name: string;
  /** Always carries an explicit tag other than `latest`. */
  image: string;
  /** `data:image/svg+xml;base64,…`; render it in an `<img>`, never inline. */
  icon: string;
  port?: number;
  /** Exposed on the app's domain. At most one service per template. */
  public?: boolean;
  volume?: { path: string; size_gib: number };
}

/** A value the user fills in before deploying. */
export interface MarketplaceInput {
  name: string;
  label: string;
  placeholder?: string;
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
