export type Project = {
  id: string
  slug: string
  name: string
  servers: number
  updatedAt: string
}

export const SEED_PROJECTS: Project[] = [
  {
    id: "project-prod",
    slug: "prod-cluster",
    name: "Production",
    servers: 4,
    updatedAt: "Updated 12 min ago",
  },
  {
    id: "project-data",
    slug: "data-platform",
    name: "Data platform",
    servers: 6,
    updatedAt: "Updated 3 hours ago",
  },
  {
    id: "project-edge",
    slug: "edge-preview",
    name: "Edge preview",
    servers: 2,
    updatedAt: "Updated yesterday",
  },
  {
    id: "project-ai",
    slug: "ai-training",
    name: "AI training",
    servers: 3,
    updatedAt: "Updated 4 days ago",
  },
  {
    id: "project-internal",
    slug: "internal-tools",
    name: "Internal tools",
    servers: 2,
    updatedAt: "Updated 1 week ago",
  },
  {
    id: "project-sandbox",
    slug: "sandbox",
    name: "Sandbox",
    servers: 1,
    updatedAt: "Updated 2 weeks ago",
  },
]
