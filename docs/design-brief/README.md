# Design brief: Acceleratio console design system

Status: approved, accent chosen (Teal). Phase 2 (tokens) is implemented in
`apps/frontend/src/app/tokens.css`. The rest is not built yet. This brief
replaces the visual decisions in [DESIGN.md](../DESIGN.md); DESIGN.md is
rewritten in phase 7, and until then the two disagree on color and shadow.

## Why this exists

The console has no single source of visual decisions. An audit of
`apps/frontend/src` found:

- Five names for "grey page background" (`--canvas`, `--board`, `neutral-50`,
  `neutral-100`, `zinc-50`) and 11 raw `bg-white` uses.
- Six arbitrary font sizes (`10`, `11`, `12`, `13`, `15` px and `0.8rem`) used 36 times.
- Seven radius steps plus six arbitrary radii, and six different shadows.
- Button heights of 24, 28, 32 and 36 px, and the pill navigation written three times.
- `DESIGN.md` forbids chromatic status color, while shipped screens show green and red status dots.
- No Storybook or visual tests, so visual changes are made blind.

The goal is a system where a screen is assembled from named decisions, and a
new screen cannot drift because the wrong value is not available.

## Position

Acceleratio is for platform engineers at sovereign and regulated organizations
(see [PRODUCT.md](../PRODUCT.md)). The console should feel like precise
infrastructure tooling: calm, dense, legible, and verifiably accessible. The
reference points are Vercel Geist (monochrome base, color only where it carries
meaning), Railway (canvas-first project view) and IBM Carbon (token rigor,
accessibility evidence). We borrow structure, not appearance.

## Principles

1. **State is legible without color.** Every status has an icon, a label and a
   shape. Color reinforces it and never carries it alone (WCAG 1.4.1).
2. **One accent, used for action.** The accent marks the primary action,
   selection and focus. It never decorates.
3. **Neutral surfaces, clear layers.** Four surface levels, each distinguishable
   from its neighbor at a glance. Depth comes from tone and border, shadow only
   for floating layers.
4. **Density is a setting, not an accident.** Three control heights, one type
   scale, one spacing scale.
5. **Only named values.** Components read semantic tokens. Raw palette values and
   arbitrary sizes are lint errors outside the token file.
6. **Evidence over assertion.** Contrast ratios are computed and listed here.
   WCAG 2.2 AA is the baseline.

## Token architecture

Three tiers. Components only read tier 2 or 3.

| Tier | Example | Lives in |
| --- | --- | --- |
| 1. Primitive | `neutral-0 … neutral-1000`, `accent-50 … accent-900`, `green-*`, `amber-*`, `red-*` | `tokens.css` `:root`, never used in components |
| 2. Semantic | `surface-canvas`, `surface-panel`, `text-secondary`, `border-default`, `status-success-fg` | `tokens.css`, mapped to Tailwind via `@theme inline` |
| 3. Component | `button-primary-bg`, `field-border`, `pill-nav-active-bg` | the component, only when a value differs from tier 2 |

The existing shadcn tokens (`--background`, `--primary`, `--muted`, …) stay as
aliases of tier 2, so current `ui/` components keep working during migration.

### Surfaces (light only)

| Token | Role | Value (oklch) |
| --- | --- | --- |
| `surface-canvas` | App ground behind the shell | `0.97 0 0` |
| `surface-board` | Pan-and-zoom workspaces (graph canvases) | `0.92 0 0` |
| `surface-panel` | Main content panel, dialogs, menus | `1 0 0` |
| `surface-raised` | Cards and floating bars on a board | `1 0 0` plus `border-default` |
| `surface-sunken` | Wells, table headers, code blocks | `0.975 0 0` |

Rule: `surface-raised` is only ever placed on `surface-board`,
`surface-sunken` or `surface-canvas`, never on `surface-panel` without a border.

Measured luminance contrast between neighbors (computed by
[`contrast.py`](./contrast.py); phase 2 turns it into a CI check):

| Pair | Ratio |
| --- | --- |
| white card on board `0.92` | 1.27:1 |
| board `0.92` on canvas `0.97` | 1.16:1 |
| panel (white) on canvas `0.97` | 1.09:1 |

The earlier board value `0.945` gave only 1.18:1 against a white card, which
is why cards and floating bars visually merged with it. At `0.92` the step is
clearly visible while text on the board still passes AA.

### Borders

| Token | Use | Value | vs panel | vs board `0.92` |
| --- | --- | --- | --- | --- |
| `border-subtle` | Dividers inside a surface | `0.93 0 0` | 1.23:1 | n/a |
| `border-default` | Card and panel edges | `0.87 0 0` | 1.48:1 | n/a |
| `border-control` | Input, select, checkbox boundary | `0.60 0 0` | 3.95:1 | 3.12:1 |

Borders that are the only cue for a control use `border-control` (WCAG 1.4.11,
3:1 minimum). Everything else is decorative and may be lighter. For reference,
today's `--input` (`0.822`) measures 1.73:1 on white and fails.

### Text

| Token | Value | Ratio on panel | Ratio on board `0.92` |
| --- | --- | --- | --- |
| `text-primary` | `0.145 0 0` | 19.79:1 | 15.62:1 |
| `text-secondary` | `0.44 0 0` | 7.77:1 | 6.13:1 |
| `text-tertiary` | `0.50 0 0` | 6.00:1 | 4.74:1 |
| `text-disabled` | `0.70 0 0` | exempt (inactive) | exempt |

`text-tertiary` replaces today's Slate (`0.556`), which measures 4.73:1 on
white but 4.53:1 on Enamel and 4.03:1 on a `0.94` board, so it fails AA for
body text on tinted surfaces. All ratios in this brief are computed, not
estimated.

### Accent

One hue, one scale. The three candidates are rendered in
[`mock/index.html`](./mock/index.html); only one is chosen.

| Candidate | Hue | `accent-600` (action) | White text on it | Character |
| --- | --- | --- | --- | --- |
| A. Indigo | 268 | `0.50 0.19 268` | 6.31:1 | Calm, technical, common in dev tooling |
| B. Teal | 195 | `0.52 0.10 195` | 5.15:1 | Distinct from status colors, "infrastructure" feel |
| C. Blue | 252 | `0.52 0.19 252` | 5.45:1 | Familiar, but close to the Docker logo and `info` |

All three pass 4.5:1 for white text. Accent usage is limited to: primary button
fill, selected nav item indicator, focus ring, links, selected row or node
outline, and progress.

### Status

Status colors are separate from the accent and carry fixed meaning.

| Status | Icon | Label example | Foreground | On panel | Wash |
| --- | --- | --- | --- | --- | --- |
| success | filled circle | Running | green `0.52 0.14 150` | 5.17:1 | green 8% |
| warning | triangle | Degraded | amber `0.55 0.13 75` | 4.95:1 | amber 10% |
| danger | filled square | Failed | red `0.54 0.22 27` | 5.67:1 | red 8% |
| neutral | hollow circle | Draft | `text-secondary` | none |
| progress | spinner | Deploying | accent | accent 8% |

Shape differs per status so the set stays distinguishable in grayscale.
This supersedes the "One Signal Rule" in `DESIGN.md`.

## Typography

Inter for UI, Geist Mono for identifiers, addresses, image tags and metrics.

| Token | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `text-xs` | 11 / 16 | 500 | Badges, key hints, table meta |
| `text-sm` | 13 / 20 | 400, 500 | Dense UI: nav, buttons, table cells, menus |
| `text-base` | 14 / 22 | 400 | Body, form values, descriptions |
| `text-lg` | 18 / 26 | 600 | Panel and dialog titles |
| `text-xl` | 24 / 30 | 600 | Page titles |

Five steps replace the six arbitrary sizes. Tracking: `-0.02em` at `xl`,
`-0.01em` at `lg`, default elsewhere.

## Shape, depth, spacing

- **Radius:** `control` 8px (buttons, inputs, nav items), `surface` 12px (cards,
  panels, menus, dialogs), `pill` 9999px (floating toolbars, status badges, tabs).
  Nothing else.
- **Shadow:** `none` (default), `float` (floating bars and menus, one soft
  layer plus a hairline), `modal` (dialogs). Two shadows replace six.
- **Spacing:** 4px base. Allowed steps 4, 8, 12, 16, 24, 32. Page gutter 12px
  on the shell, 24px inside panels.
- **Control heights:** `sm` 28, `md` 32, `lg` 40. Pills and inputs in the same
  row share a height.
- **Icons:** Lucide, 16px, 1.75 stroke. 14px only inside `sm` controls.

## Layout patterns

1. **Shell.** Canvas ground, 48px top bar without fill, content panel inset
   12px with `surface-panel`, `border-default`, radius `surface`.
2. **Workspace (project, servers).** The panel contains a `surface-board`.
   A `FloatingBar` pins top-left (identity and section tabs as a pill) and
   top-right (primary action). A `SidePanel` slides from the right and anchors
   below the bar through a shared offset token, so no screen hardcodes it.
3. **List page.** `PageHeader` (title, description, primary action), then a
   `DataTable` or card grid on `surface-panel`.
4. **Detail and settings.** Left section nav, right content, max readable width.
5. **Auth.** Unchanged: the datacenter threshold in `DESIGN.md` stays.

## Component inventory

Normalize: `Button` (three heights, variants `primary`, `secondary`,
`ghost`, `danger`), `Input`, `Select`, `Textarea`, `Dialog`, `DropdownMenu`,
`Tabs`.

Add: `Surface`, `Card`, `StatusBadge`, `PillNav` (replaces three
implementations), `FloatingBar`, `SidePanel`, `PageHeader`, `EmptyState`,
`Tooltip`, `DataTable`, `Toast` variants for the status set.

## Enforcement

- ESLint rule (or `eslint-plugin-tailwindcss` config) banning, outside
  `globals.css` and `tokens.css`: `bg-white`, `bg-black`, any
  `*-(neutral|zinc|gray|slate)-N`, `text-[Npx]`, `rounded-[…]`, and raw hex.
- A `/design` route (development only) rendering every token and component
  state, used for review and as the Playwright screenshot target.
- Playwright visual snapshots for the shell, a workspace, a list page and each
  component state.
- A contrast script that reads `tokens.css`, computes ratios for every
  text/surface and border/surface pair listed above, and fails CI under AA.

## Phases and commits

Work stays on one branch with small commits, as agreed.

1. **Brief approved.** Choose accent. Merge this document.
2. **Tokens.** `tokens.css`, Tailwind mapping, shadcn aliases, contrast script.
   No visual change beyond the new values.
3. **Lint.** ESLint rule in warning mode, then count and burn down violations.
4. **Primitives.** Normalize `ui/`, add the components above, `/design` page.
5. **Shell and workspace.** Dashboard layout, `FloatingBar`, `SidePanel`,
   project canvas, servers canvas.
6. **Screens.** Projects list, workloads, settings, then auth tweaks.
7. **Tests and docs.** Visual snapshots, rewrite `DESIGN.md`, set lint to error.

## Decisions

- Accent: **B. Teal** (`--teal-600`, `oklch(0.52 0.10 195)`). Chosen because it
  stays clear of the status colors and the Docker blue.
- Token names: semantic tokens are `surface-*`, `edge-*`, `fg-*`, `brand` and
  `status-*`, not `border-*`, `text-*` or `accent-*`. Those names are already
  taken by Tailwind utilities and shadcn tokens, so reusing them would be
  ambiguous. `--primary`, `--ring` and the other shadcn tokens are now aliases
  of the semantic tokens, which turns primary buttons and focus rings teal.
- `bun run check:contrast` (`apps/frontend/scripts/check-contrast.mjs`) reads
  `tokens.css` and checks 28 text, control-border and focus pairs. It passes.

## Open decisions

- Whether dark mode is in scope. This brief assumes light only, as `DESIGN.md`
  does today; the token tiers leave room to add it later.
- Whether application developers outside the operator team get console access
  at launch (open in `PRODUCT.md`). It affects density and default views.
- Target accessibility conformance document (VPAT or similar) for procurement.
