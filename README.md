# Acceleratio

**Your cloud. Your data. Your control.**

[![CI](https://github.com/acceleratio-cloud/core/actions/workflows/ci.yml/badge.svg)](https://github.com/acceleratio-cloud/core/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/acceleratio-cloud/core)](https://github.com/acceleratio-cloud/core/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

Acceleratio is an open-source, self-hosted alternative to Railway, Render,
Northflank and Vercel. One command turns a server you own into a private cloud
with a web console for deploying and running apps, databases and sites. The
control plane, the workloads and the data stay on your infrastructure: no
vendor account, no hosted service.

## Features

- **Apps from an image or a repository.** Run any Docker image, or connect
  GitHub and deploy a branch: it builds from a `Dockerfile` or detects the
  stack, and redeploys on every push.
- **PostgreSQL databases.** Create, back up continuously, restore to any moment
  of the last 7 days, import and export dumps.
- **Static sites** uploaded as a folder, with versions and rollback.
- **One-click apps** from a catalog: n8n, Grafana, Gitea, Nextcloud, Outline,
  Plausible, Vaultwarden and more.
- **Domains with automatic HTTPS.** A generated domain for every service, and
  custom domains with Let's Encrypt certificates.
- **Private networking.** Services of a project reach each other by name
  (`postgres.internal`); projects are isolated from each other.
- **Storage.** Persistent volumes and S3-compatible buckets.
- **Logs and metrics** per project, with live tail and search, and a terminal
  into running containers.
- **Servers and updates from the console.** Add servers to the cluster and
  update the platform without SSH.

## Quick start

You need a fresh Ubuntu 22.04/24.04 or Debian 12 server (VM or bare metal,
amd64 or arm64) with 2 vCPU, 4 GiB RAM and 20 GiB of free disk. See the
[full requirements](./scripts/README.md#requirements).

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/scripts/install.sh | sudo bash
```

When it finishes, open the printed dashboard URL (`http://<server-ip>:30300`)
and create the first account. Open TCP ports `30300` and `30080` if the page
does not load, and `80` and `443` for custom domains.

To read the script before running it, download it with `curl -fsSLO` instead.
Versions, addresses, domains and TLS are configured with environment variables
or an [`install.env`](./scripts/install.env.example) file.

### Update and uninstall

Update from Settings → System in the console, or on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/scripts/update.sh | sudo bash
```

The updater backs up first and rolls back if the new version does not come up.
To remove everything, including the data:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/scripts/uninstall.sh | sudo bash -s -- --yes
```

## How it works

The installer sets up a single-node Kubernetes cluster from open components and
runs Acceleratio on it. Everything can be inspected with standard Kubernetes
tools.

| Component | Role |
|---|---|
| [k3s](https://k3s.io) | Kubernetes with embedded etcd |
| [Cilium](https://cilium.io) | networking and project isolation |
| [Longhorn](https://longhorn.io) | persistent volumes |
| [RustFS](https://rustfs.com) | S3 object storage, backups, site files |
| [CloudNativePG](https://cloudnative-pg.io) | PostgreSQL databases |
| [Traefik](https://traefik.io) | ingress and Let's Encrypt certificates |
| [VictoriaMetrics](https://victoriametrics.com), [VictoriaLogs](https://docs.victoriametrics.com/victorialogs/) and [Vector](https://vector.dev) | metrics and logs |

Acceleratio itself is a NestJS API (`apps/api`), a Next.js console
(`apps/frontend`) and a typed contract between them (`packages/shared`), with
its own PostgreSQL.

## Status

Acceleratio is in early development. The verified setup is a single server on
Ubuntu 22.04, Ubuntu 24.04 or Debian 12; clusters of several servers can be
built from the console but are not yet verified. See
[docs/PRODUCT.md](./docs/PRODUCT.md) for what is shipped and what is not.

## Documentation

- [Installer, updater and uninstaller](./scripts/README.md)
- [Product scope](./docs/PRODUCT.md)
- [Design system](./docs/DESIGN.md)
- [Code structure](./docs/FILE_STRUCTURE.md)
- [Database](./docs/DATABASE.md)

## Contributing

Contributions are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) explains the
development setup and how to get a change merged. Please follow the
[Code of Conduct](./CODE_OF_CONDUCT.md), and report vulnerabilities as described
in [SECURITY.md](./SECURITY.md).

## License

[Apache License 2.0](./LICENSE)
