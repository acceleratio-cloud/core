import type { ControlPlaneDnsCheck } from "./system";

/** Result of resolving a hostname against public resolvers. */
export type DnsCheck = ControlPlaneDnsCheck;

/**
 * `generated`: the service's sslip.io domain; it needs no DNS setup.
 * `custom`: a hostname the user owns and points at the server.
 */
export type WorkloadDomainKind = "generated" | "custom";

/**
 * `generated`: an sslip.io domain, routed and served over HTTPS.
 * `verification`: a custom domain waiting for its A record, then for its
 *   HTTPS certificate. It is not routed until the record verifies.
 * `success`: a custom domain that serves a trusted certificate.
 * `failed`: the certificate was not issued in time; see `status_message`.
 */
export type WorkloadDomainStatus =
  | "generated"
  | "verification"
  | "success"
  | "failed";

/**
 * HTTPS certificate of a domain, separate from its routing status.
 * `waiting`: not routed yet, so no certificate can be requested.
 * `issuing`: routed; Let's Encrypt has not issued a trusted certificate yet,
 *   so browsers show a certificate warning.
 * `issued`: the hostname serves a trusted certificate.
 * `failed`: none was issued within 10 minutes; see `status_message`.
 */
export type WorkloadDomainCertificate =
  | "waiting"
  | "issuing"
  | "issued"
  | "failed";

/** A DNS record the user must create at their DNS provider. */
export interface DnsRecordInstruction {
  type: "A";
  /** Full hostname; some providers want only the part before the zone. */
  name: string;
  /** Address the record must point to. */
  value: string;
}

export interface WorkloadDomain {
  id: string;
  workload_id: string;
  hostname: string;
  /** Always `https://<hostname>`. */
  url: string;
  kind: WorkloadDomainKind;
  /** Container port the domain sends traffic to. */
  port: number;
  status: WorkloadDomainStatus;
  status_message: string | null;
  /** True once the domain has Traefik routes in the cluster. */
  routed: boolean;
  certificate: WorkloadDomainCertificate;
  /** Records to create; empty for generated domains. */
  dns_records: DnsRecordInstruction[];
  /** Latest DNS check; null when none ran in this response. */
  dns: DnsCheck | null;
  /** ISO 8601; when the routes were published and the certificate requested. */
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkloadDomains {
  /** Address custom domains must point to; null when it cannot be detected. */
  expected_ip: string | null;
  /** Suffix of the generated domain, such as `-203-0-113-10.sslip.io`. */
  generated_suffix: string | null;
  /** Label the generate dialog starts with, derived from the service name. */
  suggested_label: string;
  domains: WorkloadDomain[];
}

export interface GenerateWorkloadDomainPayload {
  /** First part of the sslip.io hostname; letters, digits and hyphens. */
  label: string;
  port: number;
}

export interface AddWorkloadDomainPayload {
  hostname: string;
  port: number;
}

export interface UpdateWorkloadDomainPayload {
  port: number;
}
