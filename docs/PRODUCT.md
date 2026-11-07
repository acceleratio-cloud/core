# Product

Acceleratio - open source alternative to Railway, Render, Northflank and Vercel.

## Platform

web

## Users

Sovereign and regulated organizations that must run workloads and keep data on infrastructure they control.

The people using the console are the technical operators inside those organizations — platform and infrastructure engineers who install Acceleratio on their own cluster, create the first account, and then run and inspect the platform from a browser. Their job: stand the platform up without vendor help, and operate it while the control plane stays inside their own boundary.

Open decision: whether application developers outside that core operator team also get console access at launch.

## Product Purpose

Acceleratio is an open-source, self-hosted cloud platform. The console is its operator-facing surface: install the platform, sign in, and manage the organization's own infrastructure.

Near-term success: a new operator can install Acceleratio on their own cluster and reach first login without hand-holding.

## Positioning

Open-source, self-hosted PaaS — the deploy-and-operate experience of a managed platform, running entirely on the customer's own cluster, with data and the control plane staying inside the organization's infrastructure.

## Operating Context

- Installation targets a self-managed Kubernetes (k3s) cluster the operator controls. The verified reference deployment is a single Ubuntu 22.04, Ubuntu 24.04 or Debian 12 node that is both control plane and worker, provisioned by `deploy/install.sh` over SSH. More servers can be added, cordoned, drained and removed from the console's Servers page; that flow is not yet verified on a multi-node cluster.
- Docker services are published through k3s's bundled Traefik with Let's Encrypt certificates: one generated sslip.io domain per service and custom domains that go live once their A record points to the server. Ports 80 and 443 must be reachable from the internet. The local k3d cluster runs without Traefik, so domains cannot be served in local development.
- Every project is one private network. Each Docker service has a private name, `<hostname>.internal` (the slug of its name, editable), that every service of the same project reaches on any port; a database needs no public domain. The name never resolves in another project, and Cilium drops traffic between projects even by cluster IP or FQDN. It is always on and cannot be turned off. The name resolves to the current instances, so a client that caches the address must resolve it again after the target restarts. It needs k3s's CoreDNS (or a Corefile that imports `coredns-custom`). Separate networks inside a project are not offered.
- Docker services can mount up to 10 persistent volumes (1–100 GiB each) backed by SeaweedFS through the platform storage profile or a custom one. Volumes are part of the service config: they are created, re-pathed and deleted on deploy; a rollback restores everything else and leaves volumes as they are. A service with volumes is redeployed with the Recreate strategy, so two copies never write the same data, at the cost of a short pause on each deploy and restart. The size is a quota, not reserved space: volumes share the storage servers' free disk, and SeaweedFS fails every write once a volume is full, which can leave the file being written empty. Resizing a volume, showing its usage or moving it to another storage profile is not shipped yet. Profiles that retain data after deletion cannot back volumes.
- The installed release and the versions of its components are shown in Settings → System. The API checks GitHub Releases for newer stable releases every 6 hours and on demand. An update is started from the console without SSH: a privileged Job hands the release's checksum-verified `update.sh` to a systemd unit on the server. That unit backs up, updates, verifies and rolls back on failure, and the console follows its steps and log. Updates need internet access. There is no update channel other than stable, no offline bundle and no downgrade from the console yet, and there are no roles: any signed-in account can start an update.
- Each project has a Logs tab: the stdout and stderr of all its Docker services in one time-ordered list, narrowed by service, pod, level and text, with a live mode that keeps following across deploys and restarts. Vector collects the lines into VictoriaLogs on the server's own disk, kept 7 days or up to 2 GiB, whichever comes first. A noisy pod is throttled at 2,000 lines/s at collection. Logs of the platform itself are not collected, and there are no saved searches, alerts or log export beyond downloading the loaded lines yet.
- Local development runs the console and API from source, with Postgres in Docker Compose.
- The console is a browser application; the API ("core") is a separate NestJS service; a shared package defines the typed contract between them.
- A fresh install begins with a one-time bootstrap step that creates the initial account, followed by normal sign-in.
- Buyers evaluate the product without a vendor account, managed service, or hosted dependency.

## Brand Commitments

- Name: Acceleratio. The console titles itself "Acceleratio Cloud Console" and renders the mark as the Acceleratio glyph followed by "cceleratio.cloud".
- Open source is a stated commitment, from the project README: "Acceleratio - Open Source Post Cloud Platform."
- Shipped voice, keep the register: direct, ownership-led, restrained — "Your cloud. Your data. Your control." and "Next-generation infrastructure. Private and secure by design." No hype or vendor-style superlatives.

## Evidence on Hand

- Brand mark: `apps/frontend/src/shared/icons/logo-icon.tsx`.
- Auth imagery: six datacenter renders in `apps/frontend/public/auth/`, generated to the style guide and ledger in `docs/ILLUSTRATIONS.md`.
- Working screens: sign-in (`apps/frontend/src/modules/auth/containers/login-form.tsx`), first-run setup (`installation-form.tsx`), dashboard shell (`apps/frontend/src/shared/layouts/`).
- Deployment record: single-node k3s with embedded etcd, Cilium and SeaweedFS verified on Ubuntu 22.04, Ubuntu 24.04 and Debian 12; procedure and limitations are in `deploy/README.md` — internal engineering evidence, not a customer reference.
- Absent and must not be fabricated: customers, testimonials, user logos, case studies, benchmarks, uptime figures, pricing, compliance certifications, or procurement approvals.

## Product Principles

1. The organization that owns the metal owns the outcome: install, bootstrap, and operate without vendor involvement.
2. Self-hosting is the product, not a lesser edition of it.
3. The control plane stays inside the customer's boundary; no hidden dependency on a hosted service.
4. Show only what ships — planned sections are never presented as capability.
5. Procurement-grade rigor: accessibility and security claims are demonstrated, not asserted.

## Accessibility & Inclusion

Sovereign and regulated buyers impose procurement accessibility conformance. Treat WCAG 2.2 AA as the baseline, and expect documented conformance evidence for public-sector procurement; the specific target certification is not yet recorded.
