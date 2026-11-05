# Security Policy

Acceleratio runs with broad permissions in the cluster it manages (the API is
bound to `cluster-admin`), so we take security reports seriously.

## Supported versions

Only the latest release receives security fixes. Please upgrade before
reporting, if you can, and say which version you tested.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a vulnerability.**

Report it privately through GitHub:
<https://github.com/acceleratio-cloud/core/security/advisories/new>
("Report a vulnerability" on the repository's Security tab).

Please include:

- the affected component (API, console, installer) and version;
- steps to reproduce, or a proof of concept;
- the impact you expect, and any suggested fix.

Do not include real credentials, kubeconfigs or customer data.

## What to expect

- We aim to acknowledge a report within 3 business days.
- We will confirm the issue, keep you updated, and agree on a disclosure date
  with you. We aim to ship a fix before details are made public.
- We credit reporters in the release notes unless you prefer to stay anonymous.

## Scope

In scope: the API, the console, the shared package, and the installer, updater
and uninstaller in `deploy/`.

Out of scope: vulnerabilities in third-party components (k3s, Cilium,
SeaweedFS, Traefik, VictoriaMetrics, PostgreSQL) unless Acceleratio configures
them insecurely; report those to the upstream project. Findings that need a
cluster administrator's credentials to begin with, denial of service through
resource exhaustion on a single-node install, and missing hardening headers
with no demonstrated impact are also out of scope.

Please test only against installations you own. Do not access data that is not
yours, and do not degrade a service you do not operate.
