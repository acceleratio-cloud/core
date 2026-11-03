# Design brief: Acceleratio console design system

Status: approved. The brand is white and the console is **dark only**. Tokens are
implemented in `apps/frontend/src/app/tokens.css` and every existing screen
reads them. Primitives, lint, `/design` and visual tests are not built yet.
This brief replaces the visual decisions in [DESIGN.md](../DESIGN.md);
DESIGN.md is rewritten in phase 7, and until then the two disagree on color,
theme and shadow.

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

### Surfaces (dark only)

| Token | Role | Value (oklch) |
| --- | --- | --- |
| `surface-canvas` | App ground behind the shell | `0.12 0 0` |
| `surface-board` | Pan-and-zoom workspaces (graph canvases) | `0.145 0 0` |
| `surface-sunken` | Input fill, wells, code blocks | `0.145 0 0` |
| `surface-panel` | Main content panel | `0.175 0 0` |
| `surface-raised` | Cards, dialogs, menus, floating bars | `0.225 0 0` |
| `surface-muted` | Hover, selected and disabled fills | `0.28 0 0` |

Higher means closer to the user: canvas is the lowest layer, raised and muted
sit above the panel. Inputs are the exception, they are sunken into whatever
they sit on.

Measured luminance contrast between neighbors (from `check:contrast`):

| Pair | Ratio |
| --- | --- |
| raised vs board | 1.16:1 |
| raised vs panel | 1.11:1 |
| panel vs canvas | 1.07:1 |
| panel vs board | 1.04:1 |
| muted vs raised | 1.17:1 |

These steps are small. In a dark UI the eye separates layers mostly by edges,
so every surface that sits on another one carries `edge-default` (1.50:1 against
the panel, 1.35:1 against raised). Do not rely on tone alone to separate two
panels. `surface-panel` against `surface-board` is the weakest pair; if the
project canvas reads as flat in review, lower `surface-board` before adding
shadows.

### Edges

| Token | Use | Value | vs panel | vs raised |
| --- | --- | --- | --- | --- |
| `edge-subtle` | Dividers inside a surface | `0.25 0 0` | decorative | decorative |
| `edge-default` | Card and panel edges | `0.32 0 0` | 1.50:1 | 1.35:1 |
| `edge-control` | Input, select, checkbox boundary | `0.56 0 0` | 4.08:1 | 3.68:1 |

Edges that are the only cue for a control use `edge-control` (WCAG 1.4.11, 3:1
minimum). Everything else is decorative and may be lighter.

### Text

| Token | Value | on panel | on raised | on muted |
| --- | --- | --- | --- | --- |
| `fg-primary` | `0.97 0 0` | 17.39:1 | 16.06:1 | 14.67:1 |
| `fg-secondary` | `0.80 0 0` | 10.15:1 | 9.15:1 | 8.56:1 |
| `fg-tertiary` | `0.70 0 0` | 7.10:1 | 6.40:1 | 5.46:1 |
| `fg-disabled` | `0.45 0 0` | exempt (inactive) | exempt | exempt |

Primary text is `0.97`, not pure white, to limit glare on large dark areas.
`fg-on-brand` is near-black (`0.12 0 0`): the brand fill is near-white and
carries dark labels. All ratios are computed by `check:contrast`, not estimated.

### Brand

The primary color is **white**: a near-white key with near-black text on
neutral, hue-free blacks, the monochrome look of a terminal or a rack panel. The
brand went Teal (hue 195, see [`mock/index.html`](./mock/index.html), which
shows the light theme), then blue (hue 245), then saturated blue (hue 262),
and finally white after review of the dark UI. The values below replace the mock.

Color is reserved for meaning. The one chromatic accent is a light sky blue,
`brand-fg`, used like a signal light: links, focus rings and selected text.
It is never a fill.

| Token | Value | Use | Check |
| --- | --- | --- | --- |
| `brand` | `neutral-970` `0.97 0 0` | Fill: primary buttons, selected option | `fg-on-brand` on it 18.61:1 |
| `brand-hover` | `neutral-910` `0.91 0 0` | Hover on the fill (dims, never brightens) | 15.53:1 |
| `brand-press` | `neutral-860` `0.86 0 0` | Pressed fill | 13.26:1 |
| `fg-on-brand` | `neutral-120` `0.12 0 0` | Text and icons on the fill | n/a |
| `brand-fg` | `sky-300` `0.8 0.12 235` | Links, focus ring, selected text and outline | 10.35:1 on panel, 9.33:1 on raised |
| `brand-wash` | white at 8% | Selected nav item, node selection halo | n/a |

A white fill is the brightest thing on screen, so it is limited to one
primary action per view. Everything else uses `outline`, `secondary` or
`ghost`.
### Status

Status colors are separate from the brand and carry fixed meaning.

| Status | Shape | Label example | Foreground | On raised |
| --- | --- | --- | --- | --- |
| success | filled circle | Running | `green-400` `0.74 0.15 150` | 7.87:1 |
| warning | triangle | Degraded | `amber-400` `0.80 0.14 80` | 9.03:1 |
| danger | filled square | Failed | `red-400` `0.70 0.19 25` | 5.88:1 |
| neutral | hollow circle | Draft | `fg-secondary` | 9.15:1 |
| progress | spinner | Deploying | `brand` | 7.76:1 |

Shape differs per status so the set stays distinguishable in grayscale.
This supersedes the "One Signal Rule" in `DESIGN.md`.

### Overlays and depth

- `scrim` (`black` at 60%) dims the page behind dialogs.
- `shadow-float` for floating bars, `shadow-modal` for dialogs and the sign-in
  card. Shadows are barely visible on dark grounds, so floating layers also
  keep an `edge-default` border.
- React Flow variables (edges, handles, node fill, controls) are overridden in
  `globals.css` from the same tokens, so graph canvases follow the theme.

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

- **Radius:** one base, `--radius` = 12px, and every step derives from it:
  `control` 9.6px (0.8x: nav items, icon buttons), `surface` 16.8px (1.4x: cards,
  panels, menus, dialogs), `pill` 9999px (floating toolbars, status badges, tabs).
  Buttons and fields use `rounded-sm` (0.6x, 7.2px), and `rounded-lg` (12px) is the
  default for small cards. The base was 10px before; raising it to 12px rounds
  every step by 20% without touching components.
  Nothing else.
- **Shadow:** `none` (default), `float` (floating bars and menus, one soft
  layer plus a hairline), `modal` (dialogs). Two shadows replace six.
  Buttons add three small `key` shadows (`shadow-key`, `shadow-key-soft`,
  `shadow-key-pressed`). The white key has a 1px inner bottom shade, dark keys a
  1px inner top highlight, both over a contact shadow; the inset shadow reads as
  pressed in. No gradients.
- **Spacing:** 4px base. Allowed steps 4, 8, 12, 16, 24, 32. Page gutter 12px
  on the shell, 24px inside panels.
- **Control heights:** `sm` 28, `md` 32, `lg` 40. Pills and inputs in the same
  row share a height.
- **Icons:** Lucide, 16px, 1.75 stroke. 14px only inside `sm` controls.
- **Button states:** hover dims the fill one step (`brand` to `brand-hover`);
  press moves it to `brand-press`, scales to 0.98 over 100ms, and swaps the key
  shadow for the inset one. Focus is a 2px `ring` outline with a 2px offset.
  `loading` shows a spinner, keeps the label and width, and blocks clicks
  without dropping keyboard focus. `motion-reduce` removes the scale.
- **Button icons:** mark an icon with `data-icon="inline-start"` or
  `inline-end`. The button then trims 2px of padding on that side so the icon
  and the label sit at equal optical distance from the edges. Do not size the
  icon with `className`; the button sets it.

## Layout patterns

1. **Shell.** Canvas ground, 48px top bar without fill, content panel inset
   12px with `surface-panel`, `border-default`, radius `surface`.
2. **Workspace (project, servers).** The panel contains a `surface-board`.
   A `FloatingBar` pins top-left (identity and section tabs as a pill) and
   top-right (primary action). A `SidePanel` slides from the right and anchors
   below the bar through a shared offset token, so no screen hardcodes it.
   Service cards on the board (`node-card-primitives.tsx`) are 264px wide on
   `surface-raised` with `shadow-float`: a header with a 28px icon tile, the
   name and a five-bar status meter; then label/value rows (icon and label in
   `fg-tertiary`, value in mono); a danger notice when the rollout failed; and
   a footer that shows a small Deploy button only when a deploy is possible,
   otherwise "Deployed 3 hours ago". The meter is decorative, and the Status row
   carries the label. Selection is a `brand-fg` border plus an offset outline.
   The board uses a 20px dot grid in `edge-default`.
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

- Theme: **dark only**. No light theme, no toggle. `color-scheme: dark` is set
  on `:root`, the toaster is pinned to `dark`, and shadcn's `dark:` variants
  stay inert (no `.dark` class is applied). Reversing this means adding a second
  value set to `tokens.css`, not touching components.
- Accent: **white**. Primary fills are `neutral-970` with `neutral-120` text,
  and hover and press step down to `neutral-910` and `neutral-860`. The only
  hue is `brand-fg` (`sky-300`, `oklch(0.8 0.12 235)`) for links, focus and
  selection. White replaced the saturated blue, which made every primary action
  compete with the content and sat near the Docker mark's hue. With a white
  brand, the Docker blue on service cards no longer clashes.
- Token names: semantic tokens are `surface-*`, `edge-*`, `fg-*`, `brand` and
  `status-*`, not `border-*`, `text-*` or `accent-*`. Those names are already
  taken by Tailwind utilities and shadcn tokens, so reusing them would be
  ambiguous. `--primary`, `--ring` and the other shadcn tokens are now aliases
  of the semantic tokens, so primary buttons take `brand` and focus rings take
  `brand-fg`.
- `bun run check:contrast` (`apps/frontend/scripts/check-contrast.mjs`) reads
  `tokens.css` and checks 41 text, control-border and focus pairs. It passes.

## Open decisions

- Docker's brand blue (`#008fe2`) is the one raw color left in the app, in
  `docker-icon.tsx`. It is a third-party mark, so it stays, and it is the
  allowed exception for the lint rule.
- Whether application developers outside the operator team get console access
  at launch (open in `PRODUCT.md`). It affects density and default views.
- Target accessibility conformance document (VPAT or similar) for procurement.
