export type ClusterNodeStatus = "Ready" | "NotReady" | "Unknown";

export interface ClusterNode {
  name: string;
  status: ClusterNodeStatus;
  roles: string[];
  version: string | null;
  internal_ip: string | null;
  os: string | null;
  container_runtime: string | null;
  cpu: string | null;
  memory: string | null;
  storage: string | null;
  created_at: string | null;
  unschedulable: boolean;
  labels: Record<string, string>;
  taints: ClusterNodeTaint[];
  pod_count: number;
}

export type ClusterNodeTaintEffect =
  | "NoSchedule"
  | "PreferNoSchedule"
  | "NoExecute";

export interface ClusterNodeTaint {
  key: string;
  value: string | null;
  effect: ClusterNodeTaintEffect;
}

export interface UpdateNodeLabelsPayload {
  labels: Record<string, string>;
}

export interface UpdateNodeTaintsPayload {
  taints: ClusterNodeTaint[];
}

export type NodeDrainPodAction = "evict" | "skip" | "blocked";

export interface NodeDrainPod {
  namespace: string;
  name: string;
  action: NodeDrainPodAction;
  /** Why the pod is skipped or blocked; null for plain evictions. */
  reason: string | null;
  /** A PodDisruptionBudget currently allows no disruption for this pod. */
  pdb_blocked: boolean;
}

export interface NodeStorageRisk {
  kind: "persistent_volume" | "seaweedfs";
  namespace: string | null;
  name: string;
  reason: string;
}

export interface NodeDrainPlan {
  node: string;
  pods: NodeDrainPod[];
  /** Problems that stop a drain unless `force` is set. */
  drain_blockers: string[];
  /** Problems that stop removing the node from the cluster. */
  delete_blockers: string[];
  storage: NodeStorageRisk[];
}

export interface DrainNodePayload {
  /** Evict pods with local data or without a controller. */
  force?: boolean;
  timeout_seconds?: number;
}

export interface DeleteNodePayload extends DrainNodePayload {
  /** Must equal the node name. */
  confirm_name: string;
  /**
   * SSH access used to uninstall k3s: before the Node is deleted for a
   * worker, after it for a control-plane server (so etcd keeps quorum).
   * Without it only the Node is deleted, and a worker that still runs k3s
   * registers it again. The key is used once and never stored.
   */
  ssh?: NodeSshAccess;
}

/** SSH access for one operation. Secrets are never stored or returned. */
export interface NodeSshAccess {
  host: string;
  port?: number;
  username: string;
  private_key: string;
  passphrase?: string;
  /**
   * Expected SSH host key fingerprint ("SHA256:..."). The connection is
   * refused when the server presents another key. Required to add a server:
   * pass the `host_key` its preflight returned.
   */
  host_key?: string;
}

export type NodeJoinRole = "worker" | "server";

export interface NodeRequirementCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string | null;
}

export interface NodePreflightResult {
  ok: boolean;
  checks: NodeRequirementCheck[];
  /** Fingerprint of the host key the server presented, "SHA256:...". */
  host_key: string;
}

export interface PreflightNodePayload {
  ssh: NodeSshAccess;
  role?: NodeJoinRole;
}

export interface AddNodePayload extends PreflightNodePayload {
  /** Name the Node registers with. */
  name: string;
  role: NodeJoinRole;
  /** Address of the server on the cluster network. Defaults to the SSH host. */
  node_ip?: string;
}

export type NodeOperationType = "add" | "drain" | "remove";
export type NodeOperationStatus = "running" | "succeeded" | "failed";

export interface NodeOperation {
  id: string;
  node: string;
  type: NodeOperationType;
  status: NodeOperationStatus;
  /** Pods still to evict. */
  remaining: number;
  evicted: number;
  /** Pods that did not leave in time or were refused. */
  stuck: string[];
  message: string | null;
  /** Current step, e.g. "preflight", "install", "wait_ready", "evict". */
  step: string | null;
  /** Last lines of progress and command output, secrets removed. */
  log: string[];
  /** Email or id of the account that started it. */
  actor: string | null;
  started_at: string;
  finished_at: string | null;
}
