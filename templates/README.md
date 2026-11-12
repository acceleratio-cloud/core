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
  - { name: ADMIN_EMAIL, label: Admin email, placeholder: you@example.com }
  - { name: ADMIN_USER, label: Admin username, default: admin }
  - { name: NOTE, label: Note, required: false }
services:                     # 1 to 10; at most one public
  - name: umami
    image: ghcr.io/umami-software/umami:3.4.1   # explicit tag, never latest
    icon: umami
    port: 3000
    public: true              # gets a generated https domain
    # volumes: [{ path: /data, size_gib: 5 }]   # up to 10, 1-100 GiB each
    env:
      DATABASE_URL: 'postgres://${{ service.postgres.user }}:${{ service.postgres.password }}@${{ service.postgres.host }}:5432/${{ service.postgres.database }}'
      APP_SECRET: '${{ hex.app_secret }}'
  - name: postgres
    type: postgres            # a managed PostgreSQL 17 database, not a container
    icon: postgres
    size_gib: 5               # disk, 1-100 GiB
```

A service is a container (`type: docker`, the default) or a managed PostgreSQL
database (`type: postgres`), the same as one created in the console: backups,
the Database tab and port 5432. A database takes only `name`, `icon` and
`size_gib`; its database and user are fixed, so read them from the placeholders
below rather than writing them out. Use `type: postgres` for every app that
needs PostgreSQL.

## Placeholders

`env` values and `command` items may hold `${{ … }}` placeholders. Each one is
checked when the template loads and filled in when the app is deployed:

| Placeholder | Value |
| --- | --- |
| `password.<id>` | 32 random letters and digits |
| `hex.<id>` | 64 random hex characters (32 bytes) |
| `base64.<id>` | 64 random base64 characters (48 bytes) |
| `input.<NAME>` | what the user entered for that input |
| `service.<name>.host` | private hostname of a template service, such as `umami-postgres.internal` |
| `service.<name>.user`, `.database`, `.password` | login of a `type: postgres` service |
| `app.url` | `https://` URL of the public service |
| `app.host` | hostname of the public service |

A generated value with the same placeholder is the same everywhere in one
deploy, so a database and the app that uses it get one password. Users can see
and change the values afterwards in the service's Environment tab.

## Deploying

`POST /marketplace/apps/<slug>/deploy` with a `project_id` (an existing project)
or a `project_name` (a new one). The API creates one service per template
service (the first named as the user chose, the others `<name>-<service>`),
gives the public service a generated sslip.io domain, fills the placeholders and
deploys every service. If any step fails, it removes what it created, the project
too when it was new; the error says when something could not be removed. If the
API itself stops in the middle of a deploy, nothing is rolled back: remove the
half-made services or project in the console.

Placeholders are filled once, when the app is deployed. Rotating a database's
password later does not update the apps that use it: change their env too. Renaming a service's
private hostname, deleting its generated domain or adding a custom domain later
does not change the env: update values that hold `service.<name>.host`,
`app.url` or `app.host` by hand.
