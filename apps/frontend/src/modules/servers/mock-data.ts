export type ServerStatus = "ready" | "not-ready" | "provisioning"

export type ServerRole = "control plane" | "worker"

export type Server = {
  id: string
  name: string
  role: ServerRole
  ip: string
  cpu: number
  mem: number
  status: ServerStatus
}

export const CLUSTER = {
  name: "prod-cluster",
  runtime: "k3s",
} as const

export const SEED_SERVERS: Server[] = [
  {
    id: "server-01",
    name: "server-01",
    role: "control plane",
    ip: "10.0.0.10",
    cpu: 22,
    mem: 41,
    status: "ready",
  },
  {
    id: "server-02",
    name: "server-02",
    role: "worker",
    ip: "10.0.0.11",
    cpu: 58,
    mem: 63,
    status: "ready",
  },
  {
    id: "server-03",
    name: "server-03",
    role: "worker",
    ip: "10.0.0.12",
    cpu: 44,
    mem: 51,
    status: "ready",
  },
  {
    id: "server-04",
    name: "server-04",
    role: "worker",
    ip: "10.0.0.13",
    cpu: 0,
    mem: 0,
    status: "not-ready",
  },
]
