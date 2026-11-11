export type AuditOutcome = 'success' | 'failure';

/** Who started the action: a console account, or a push on GitHub. */
export type AuditActorType = 'user' | 'github';

/** One recorded action in a project, kept after its service or account is gone. */
export interface AuditLogEntry {
  id: string;
  created_at: string;
  /** Null only for a failed create that never got a project. */
  project_id: string | null;
  /** Dotted action name, such as `service.deploy` or `database.credentials.reveal`. */
  action: string;
  outcome: AuditOutcome;
  /** HTTP status the console got back; null for actions outside a request. */
  status_code: number | null;
  error: string | null;
  actor_type: AuditActorType;
  /** Account id; null for a GitHub pusher. */
  actor_id: string | null;
  /** Name and email copied when the action ran. */
  actor_name: string | null;
  actor_email: string | null;
  session_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  /** The service the action touched, with its name at that time. */
  workload_id: string | null;
  workload_name: string | null;
  http_method: string | null;
  http_path: string | null;
  duration_ms: number | null;
  /** Route parameters, the request body with secrets redacted, and other context. */
  metadata: Record<string, unknown>;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** Pass as `before` to read older entries; null on the last page. */
  next_cursor: string | null;
}

/** A service that appears in the audit log, deleted ones included. */
export interface AuditLogWorkload {
  id: string;
  /** Its name in the newest entry. */
  name: string | null;
}
