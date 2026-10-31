export type ClusterNodeStatus = "Ready" | "NotReady" | "Unknown";

export interface ClusterNode {
  name: string;
  status: ClusterNodeStatus;
  roles: string[];
  version: string | null;
  internalIp: string | null;
  os: string | null;
  containerRuntime: string | null;
  cpu: string | null;
  memory: string | null;
  storage: string | null;
  createdAt: string | null;
}
