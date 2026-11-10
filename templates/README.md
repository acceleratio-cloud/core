# Marketplace templates

One file per app in `apps/<slug>.yaml`; the file name is the slug in the console URL.
Icons are SVG files in `icons/<name>.svg` (32 KB at most), referenced by name from
an app and from each of its services.

The API reads this folder at startup (`MARKETPLACE_TEMPLATES_DIR` overrides the
path; the image has it at `/app/templates`) and serves it at `GET /marketplace/apps`.
The schema is strict: a field it does not name fails the template. See
`apps/api/src/application/marketplace/marketplace-template.ts` for every rule, and
run `cd apps/api && bun run test -- marketplace` after editing a template.

```yaml
schema_version: 1
name: Umami
icon: umami
category: Analytics           # one of MARKETPLACE_CATEGORIES in packages/shared
tagline: One line for the card.
description: |
  Paragraphs, separated by a blank line.
features: [Short phrases]
license: MIT
repository: https://github.com/umami-software/umami
website: https://umami.is
resources: { cpu: 0.5, memory_mib: 512 }
inputs:                       # optional; asked for in the deploy dialog
  - { name: DOMAIN, label: Domain, placeholder: app.example.com }
services:                     # 1 to 10; at most one public
  - name: umami
    image: ghcr.io/umami-software/umami:postgresql-v2.14.0   # explicit tag, never latest
    icon: umami
    port: 3000
    public: true
  - name: postgres
    image: postgres:17.2-alpine
    icon: postgres
    volume: { path: /var/lib/postgresql/data, size_gib: 5 }
```
