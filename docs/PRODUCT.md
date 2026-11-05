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

- Installation targets a self-managed Kubernetes (k3s) cluster the operator controls. The verified reference deployment is a single Ubuntu 22.04, Ubuntu 24.04 or Debian 12 node that is both control plane and worker, provisioned by `deploy/install.sh` over SSH.
- Docker services are published through k3s's bundled Traefik with Let's Encrypt certificates: one generated sslip.io domain per service and custom domains that go live once their A record points to the server. Ports 80 and 443 must be reachable from the internet. The local k3d cluster runs without Traefik, so domains cannot be served in local development.
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
