import type { ClusterNode, ClusterNodeStatus } from "@acceleratio/shared";

export type ServerStatus = "ready" | "not-ready" | "unknown";

export type ServerRole = "control plane" | "worker";

export type Server = {
  id: string;
  name: string;
  role: ServerRole;
  ip: string;
  cpu: string | null;
  ram: string | null;
  storage: string | null;
  status: ServerStatus;
  version: string | null;
  os: string | null;
};

const statusMap: Record<ClusterNodeStatus, ServerStatus> = {
  Ready: "ready",
  NotReady: "not-ready",
  Unknown: "unknown",
};

const controlPlaneRoles = ["control-plane", "master"];

const bytesInGb = 1024 ** 3;

const units: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
};

export const formatGigabytes = (quantity: string | null): string | null => {
  if (!quantity) {
    return null;
  }

  const match = /^([0-9.]+)([A-Za-z]*)$/.exec(quantity.trim());

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const suffix = match[2];
  const multiplier = suffix ? units[suffix] : 1;

  if (!Number.isFinite(value) || !multiplier) {
    return null;
  }

  const gigabytes = Math.round(((value * multiplier) / bytesInGb) * 10) / 10;

  return `${gigabytes} GB`;
};

export const toServer = (node: ClusterNode): Server => ({
  id: node.name,
  name: node.name,
  role: node.roles.some((role) => controlPlaneRoles.includes(role))
    ? "control plane"
    : "worker",
  ip: node.internal_ip ?? "—",
  cpu: node.cpu,
  ram: formatGigabytes(node.memory),
  storage: formatGigabytes(node.storage),
  status: statusMap[node.status],
  version: node.version,
  os: node.os,
});
