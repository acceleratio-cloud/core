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
}
