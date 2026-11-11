/**
 * Result of resolving the control plane hostname against public resolvers.
 * `valid`: the only A record is the server's public IP.
 * `mismatch`: A records exist but point elsewhere.
 * `missing`: the hostname has no A record yet.
 * `error`: the lookup failed, or the server's public IP is unknown.
 */
export type ControlPlaneDnsStatus = 'valid' | 'mismatch' | 'missing' | 'error';

export interface ControlPlaneDnsCheck {
  hostname: string;
  /** Address the A record must point to; null when it cannot be detected. */
  expected_ip: string | null;
  /** A records seen by public resolvers. */
  records: string[];
  /** AAAA records; Let's Encrypt prefers them, so stale ones break issuance. */
  aaaa_records: string[];
  status: ControlPlaneDnsStatus;
  /** ISO 8601 timestamp. */
  checked_at: string;
  /** Explanation for `error`, or a warning (such as AAAA records). */
  message: string | null;
}

/**
 * `awaiting_dns`: saved, waiting for the A record.
 * `provisioning`: routes created, waiting for the HTTPS certificate.
 * `failed`: the certificate or routing did not come up; see `error`.
 */
export type ControlPlaneChangeStatus = 'awaiting_dns' | 'provisioning' | 'failed';

export interface ControlPlaneUrlChange {
  url: string;
  hostname: string;
  status: ControlPlaneChangeStatus;
  error: string | null;
  /** Latest DNS check; null until one ran in this response. */
  dns: ControlPlaneDnsCheck | null;
}

export interface ControlPlaneSettings {
  /** Applied root URL, such as `https://cloud.example.com`; null before any change. */
  current_url: string | null;
  /** Installer address (IP and NodePort) that keeps working as a fallback. */
  fallback_url: string | null;
  pending: ControlPlaneUrlChange | null;
}

export interface SetControlPlaneUrlPayload {
  url: string;
}

export type SystemComponentState =
  | 'operational'
  | 'degraded'
  | 'down'
  | 'unknown';

/** Health of one platform component, read from its pods (or nodes). */
export interface SystemComponentStatus {
  id: string;
  /** What it does for the platform, such as `Network`. */
  role: string;
  /** What provides it, such as `Cilium`. */
  name: string;
  state: SystemComponentState;
  ready: number;
  total: number;
}
