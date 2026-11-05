---
name: Acceleratio Cloud Console
description: An open-source, self-hosted cloud console — a dark facility threshold giving way to a daylit, achromatic control room.
colors:
  graphite: "oklch(0.205 0 0)"
  graphite-deep: "oklch(0.145 0 0)"
  paper: "oklch(1 0 0)"
  enamel: "oklch(0.985 0 0)"
  mist: "oklch(0.97 0 0)"
  hairline: "oklch(0.9 0 0)"
  hairline-strong: "oklch(0.822 0 0)"
  slate: "oklch(0.556 0 0)"
  ring: "oklch(0.708 0 0)"
  signal-red: "oklch(0.577 0.245 27.325)"
  facility-black: "#0d0e0f"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(2rem, 2.8vw, 3rem)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0em"
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
spacing:
  inline-xs: "2px"
  inline-sm: "4px"
  control-x: "10px"
  stack: "20px"
  gutter: "16px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.enamel}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "oklch(0.205 0 0 / 80%)"
  button-primary-lg:
    height: "36px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite-deep}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  button-ghost:
    textColor: "{colors.graphite-deep}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  button-destructive:
    backgroundColor: "oklch(0.577 0.245 27.325 / 10%)"
    textColor: "{colors.signal-red}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite-deep}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
    height: "36px"
  nav-item:
    textColor: "{colors.graphite-deep}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.graphite}"
  nav-search:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  auth-panel:
    backgroundColor: "{colors.enamel}"
    rounded: "{rounded.xl}"
    padding: "24px"
    width: "448px"
---

# Design System: Acceleratio Cloud Console

> **Superseded in part.** The console is now dark-only with a blue brand color
> and chromatic status colors. Colors, theme, elevation, the shell and the
> status rules below describe the earlier light design and are replaced by
> `apps/frontend/src/app/tokens.css`. Typography, spacing and the auth panel
> sections still apply until this file is rewritten.

## Overview

**Creative North Star: "The Control Room"**

The console is a room you enter. Its threshold is dark and photographic — a real datacenter render, unlit corners, the product mark in white — and its interior is daylit, achromatic, and quiet. That transition is the whole visual thesis: the operator starts outside the facility, at its locked door, then steps into an instrument room where nothing competes with the reading of state.

Inside, the system is deliberately undecorated. Inter carries every role. Graphite frames, Paper carries: the chrome band is graphite with light type, the working surface stays white, and one-pixel hairlines do the structure. Shadow is withheld everywhere except two floating surfaces — the sign-in panel over the photograph and the account menu over the console. There is exactly one chromatic color in the entire system, a signal red, and it only ever means destruction or error. A dashboard that stays grey until something is wrong is a dashboard an operator can trust.

The register is calibrated and quiet. No gradient panels, no glow, no ornament, no color used as enthusiasm. Confidence is expressed through alignment, consistent row heights, and the discipline of not adding a second accent. Where the system is currently thin — one screen of console content, no mobile shell, no data-density patterns — this document records what exists rather than inventing the rest.

**Key Characteristics:**
- A dark frame around a daylit interior: a graphite chrome bar over achromatic working surfaces.
- One typeface (Inter) for every role; Geist Mono is declared for data but not yet used on a shipped surface.
- Graphite is the primary color: chrome, primary actions, and selected states. Content never sits on it.
- Exactly one chromatic color, reserved for destructive and invalid state.
- A 4px rhythm with 32px / 36px controls and 32px navigation pills.
- Light content, dark chrome: the CSS declares `color-scheme: light` and no content surface goes dark.

## Colors

An achromatic instrument palette with a single reserved alarm color.

### Primary

- **Graphite**: the primary color. It is the chrome band behind every console screen, the fill of primary buttons, and the selected-state text. A near-black rather than a brand hue — the console's identity is the absence of hue, carried by weight and alignment instead.
- **Graphite Deep**: reading text. Body copy, labels, link text, and the default navigation item on light surfaces. Twice the contrast weight of Graphite and used for anything an operator must read rather than press.

### Neutral

- **Paper**: the canvas. Page background, input fill, dropdown surfaces, table rows. Pure white, never tinted — and never the place where chrome or type-on-dark appears.
- **Enamel**: the raised sheet, and the text color on Graphite. The auth card, primary-button labels, and header type sit on it. One step off white so a panel can sit on Paper without needing a shadow.
- **Mist**: the second neutral, used for row and card hover, muted blocks, secondary fills, and the light-surface pressed state. Also the dashboard canvas behind content panes, which is why it must stay distinguishable from Paper at a glance.
- **Hairline**: structural borders. Header rule, separators, field wrappers, badge outlines, vertical dividers.
- **Hairline Strong**: input outlines. Intentionally darker than Hairline so a field boundary is visible against Paper.
- **Slate**: secondary text — subtitles, descriptions, section labels, placeholders, icon strokes. It is the most-used color after Graphite Deep.
- **Ring**: focus indication on fields and controls.
- **Facility Black**: the auth threshold only. It is the fallback beneath the datacenter photograph and the gradient scrim anchor. It never appears inside the console.

### Tertiary

- **Signal Red**: the only chromatic color in the system. Destructive button text and fill, invalid field borders, error copy. It is not a status color for healthy/running/success — those states must be expressed with weight, icon, and label, not by adding a second hue.

### Named Rules

**The Dark Frame Rule.** The chrome is graphite and the work happens on Paper. The bar frames every console screen the way the facility photograph frames the door; content surfaces never go dark. No dark mode, no dim panel, no second dark band, and no card that inverts to graphite.

**The One Signal Rule.** Signal Red is used on ≤2% of any screen and only for destruction or invalidity. If a screen needs emphasis that is not destructive, use weight, a hairline, or whitespace.

**The Grey Until Broken Rule.** A healthy console is entirely achromatic. Color entering the interface is itself the alarm.

## Typography

**Display Font:** Inter (with system-ui, sans-serif)
**Body Font:** Inter (with system-ui, sans-serif)
**Label/Mono Font:** Geist Mono (with ui-monospace, monospace) — declared in the theme, not yet used on any shipped screen.

**Character:** One grotesque, tightly tracked, used at modest sizes. The system never shouts: the largest type in the product is a statement on the sign-in screen, and every console title sits at 24px. Personality comes from tight negative tracking on titles and from the extreme regularity of 14px body copy.

### Hierarchy

- **Display** (500, clamp(2rem, 2.8vw, 3rem), 1.15): the ownership statement on the auth threshold, bottom-left over the photograph. Tracking −0.03em. It is the only place the product speaks at length, and it is set in white on the image.
- **Headline** (500, 1.5rem, 1): every screen title — "Sign In", "Initial Setup", future page headings. Tracking −0.025em, tight enough that the title reads as a label rather than a banner.
- **Body** (400, 0.875rem, 1.5): descriptions, form values, table content. Secondary body sits in Slate at the same size — hierarchy is carried by color, not size.
- **Label** (500, 0.875rem, 1): field labels and button text. Never uppercase, never letter-spaced.
- **Navigation** (400/500, 0.8125rem, 1): header pills, with the active pill at 500. One step below body so the bar never competes with the content it frames.
- **Data** (Geist Mono): reserved for identifiers, addresses, and metrics once real console surfaces exist. Do not use mono for prose or for buttons.

### Named Rules

**The Title–Subtitle Rule.** A screen opens with a 24px/500 title at leading-none and a 14px Slate subtitle 10px below it, then 24px of air before the first control group. Every screen in the product uses this same masthead; do not vary the gap or the weight per screen.

**The No-Banner Rule.** Types never grow to fill space. There is no 40px page title and no display type inside the console; the auth statement is the single display moment in the product.

## Layout

**Auth threshold.** A full-viewport grid of three rows (`1fr auto 1fr`) over a full-bleed, `object-cover` datacenter render. The mark sits top-left with 24px (32px at ≥640px) padding. The form card is centered, capped at 448px, and padded 24px, becoming 32px at ≥640px. The ownership statement is anchored bottom-left at the same padding, with its secondary line hidden below 640px. Two scrims sit over the image: a 192px top gradient for the mark and a 384px bottom gradient for the statement, so type is legible without a full-page overlay.

**Console shell.** Fixed viewport height with a single 48px graphite header spanning the full width, closed by a 1px white-at-10% edge, and a fluid main region that scrolls on its own. The header carries the brand lockup, the primary navigation, the quick search, and the account avatar in light type, with a 16px gutter. The navigation sits inline as 32px pills rather than in a rail, so the content area is never narrowed. There are no max-width containers inside the console — panes are expected to be full-bleed and to own their own internal padding.

**Rhythm.** A 4px base. Recurring steps: 2px between an icon and its label, 4px between stacked micro-elements, 6px between a label and its input, 10px of horizontal control padding, 16px of header gutter, 20px between fields in a group, 24px of panel padding. The console runs at a compact operator density: 32px navigation pills, 36px fields, 32px default buttons, 36px large buttons.

**Responsive.** The auth threshold hides its tagline below 640px and steps padding 16px → 24px → 32px. In the console header, the wordmark and the navigation labels drop out below 640px, leaving the mark and icon-only pills; the quick search appears only from 1024px. There is no compact search affordance below that, so treat search-on-small-screens as unbuilt rather than inventing a trigger.

## Elevation & Depth

The system is flat. Console surfaces are separated by one-pixel hairlines and one step of tonal shift (Paper against Enamel against Mist), never by shadow. Depth is a property of *layer of access*, not of component importance.

There are exactly two shadows. The first is the auth card's `shadow-2xl shadow-black/20`, so the sign-in panel reads as a physical sheet laid over the photograph. The second is the account menu, which sits 6px under the avatar and lifts on a 10px/4px offset pair at 10% opacity. Nothing else earns one: a future popover or command palette reuses the menu's pair rather than inventing a third, and a card that is part of the page stays flat.

### Named Rules

**The Two Lifts Rule.** Shadow is reserved for a surface that floats above something it does not belong to: the auth panel over the photograph, the account menu over the console. A surface that is part of the page uses a hairline. If a new card wants a shadow, the answer is a hairline.

**The Scrim Rule.** Gradients exist only as photographic scrims on the auth threshold. No gradient is ever applied to a UI surface, button, border, or text fill.

## Shapes

The form language is machined and rectangular: 1px borders, small radii, no clipping, no rounded silhouettes.

The radius scale derives from a single 10px base (`--radius`), so every corner in the product is a multiple of it: 6px for controls and fields, 8px for navigation pills and icon buttons, 10px for textareas and the search well, 14px for panels. Nothing is fully pill-shaped except a status badge, which is a token rather than a button.

Borders are always exactly 1px and always a solid neutral. No double borders, no inset strokes, no border gradients. Buttons carry a transparent border so that outline and filled variants share identical box dimensions.

## Components

### Buttons

- **Shape:** 6px radius (control radius), 1px transparent border, 32px default height, 36px for `lg`, 24–28px for the `xs`/`sm`/icon sizes.
- **Primary:** Graphite fill, Enamel text, 14px/500, 10px horizontal padding. Full-width on auth forms.
- **Hover / Focus:** primary hover drops the fill to 80% opacity; focus paints a 3px Ring at 50% plus a Ring border. Active presses by 1px (`translate-y-px`). Disabled is 50% opacity with pointer events off.
- **Secondary / Outline / Ghost:** outline is Paper with a Hairline border; ghost is transparent until hover, then Mist; secondary is Mist fill. All three share the same geometry, so swapping variants never changes layout. Destructive is a 10% Signal Red wash with Signal Red text — a tinted, not solid, danger button.

### Chips

- **Style:** the only pill in the system. 11px/500, Hairline outline, transparent fill, Slate text, ~2px vertical padding. Used for navigation badges such as "New".
- **State:** there is no selected chip state yet. Do not build a filter chip from this token — it is a status token, not an interactive one.

### Cards / Containers

- **Corner Style:** 14px for the auth panel, 10px for textareas and the search well, 8px for navigation rows, 6px for fields.
- **Background:** Enamel for raised panels, Paper for the page, Mist for recessed or hovered blocks.
- **Shadow Strategy:** flat; see Elevation & Depth. Only the auth panel lifts.
- **Border:** 1px Hairline when a container needs an edge; often no border at all when a tonal shift is enough.
- **Internal Padding:** 24px on panels, 10–12px inside rows and wells.

### Inputs / Fields

- **Style:** 36px height, 6px radius, Paper fill, 1px Hairline Strong border, 10px horizontal padding. Text is 16px on small viewports and 14px from 768px up, to avoid iOS zoom while staying compact on desktop.
- **Focus:** the border shifts to Ring and a 3px Ring at 50% is painted outside it. Invalid swaps both to Signal Red.
- **Error / Disabled:** disabled is 50% opacity on a Mist fill with a not-allowed cursor; invalid adds a red ring and red text on any associated field error.
- **Label:** 14px/500 Graphite Deep, 6px above the control, inside a `Field` with a 20px group gap.

### Navigation

- **Style:** a 48px Graphite header, closed by a 1px white-at-10% edge. At the left: the mark in Enamel with its wordmark, a 1px 16px white-at-15% divider, then inline 32px pills. At the right, from 1024px: a 256px search well (10px radius, white-at-15% border, white-at-5% fill, 13px placeholder, shortcut key in a white-at-10% Kbd chip). Pills carry a 14px Lucide icon at 1.75 stroke and a 13px label, with 8px of horizontal padding.
- **Default / Hover / Active:** default is Enamel at 70% with the icon at 50%; hover fills white at 5% and lifts the label to full Enamel; active is white at 10% with a full-Enamel 500-weight label, a full-Enamel icon, and `aria-current="page"`. Keyboard focus is a 2px white-at-70% ring. A vertical 1px divider separates the brand lockup from the navigation at all widths.
- **Responsive:** below 640px the wordmark and pill labels drop out, leaving the mark and icon-only pills with the label kept as a screen-reader name; the search well is hidden below 1024px. There is no overflow menu and no compact search trigger.

### Account Menu

- **Trigger:** a 32px circular avatar at the far right of the header: a white-at-10% disc with a white-at-20% rim and a 16px Enamel glyph, or 11px/500 Enamel initials when a name is known. Hover lifts the disc to white at 15%; keyboard focus paints a 2px white-at-70% ring and the open state a white-at-40% one.
- **Surface:** a 224px popover anchored to the avatar's right edge, 6px below it. Paper, 1px Hairline, 10px radius, 4px inner padding, and the system's second shadow. It opens with a 150ms fade and a 1px rise, and collapses under `prefers-reduced-motion`.
- **Items:** 32px rows, 13px labels, 14px Slate icons, Mist on highlight. Profile is a link followed by a hairline separator and Log out as a button. Log out stays neutral — leaving the console is not destructive, so it does not take Signal Red.
- **With identity:** when a name and email are available, a name/email block sits above the first separator and the trigger shows initials instead of the generic glyph. Without them the menu opens straight onto the items, with no empty header.

### Auth Panel

The product's signature composition. A 448px-wide Enamel sheet, 14px radius, 24–32px padding, carrying the only shadow in the system, centered over a full-bleed datacenter render. The mark and the ownership statement frame the image at its top-left and bottom-left corners, so the panel reads as an object placed in the room rather than a dialog over it. Every new auth-adjacent screen (password reset, invitation acceptance, first-run setup) inherits this exact frame.

## Do's and Don'ts

### Do:

- **Do** keep every console surface achromatic. If a screen needs emphasis, use weight, a hairline, or space.
- **Do** keep every content surface on Paper: the chrome is graphite, the work is not.
- **Do** set type on graphite in Enamel, with secondary text no dimmer than 70% and icons no dimmer than 50%.
- **Do** use Graphite for action and Graphite Deep for reading on light surfaces; never use one for the other.
- **Do** separate sections with a 1px Hairline or a Paper/Enamel/Mist tonal step rather than a shadow.
- **Do** open every screen with the 24px/500 title, 10px gap, 14px Slate subtitle, 24px of air.
- **Do** reuse the auth frame exactly for any new pre-console screen: 448px panel, 14px radius, top-left mark, bottom-left statement.
- **Do** keep control heights on the 32 / 36px ladder so the header, forms, and panels stay on one grid.
- **Do** hold to the 4px rhythm; 6px label-to-field and 20px field-to-field are the load-bearing gaps.

### Don't:

- **Don't** add a second accent hue, a brand blue, or a gradient to any UI surface.
- **Don't** extend graphite past the chrome band: no dark cards, no dark panels, no theme toggle. The CSS declares `color-scheme: light` and content surfaces stay light.
- **Don't** put display type inside the console; 24px is the ceiling for a page title.
- **Don't** add card shadows, glow, or glassmorphism. The auth panel is the one permitted lift.
- **Don't** use pill shapes for buttons, and don't use the nav badge token as an interactive filter chip.
- **Don't** treat Slate or Mist as decorative tints; they carry secondary text and hover state respectively.
- **Don't** ship the current accessibility regressions unchanged into new screens: the 6px input boundary measures ~1.7:1 against Paper, the focus ring ~1.5:1 against Paper (WCAG 2.2 AA non-text contrast asks for 3:1), destructive text on its 10% tint measures ~4.0:1, and Slate text on Enamel measures ~4.3:1. Fix at the token level when the next screen touches these components, rather than copying the values per screen.
- **Don't** rely on the current `input`/`textarea` radius mismatch (6px vs 10px) as a distinction; treat the textarea radius as drift to be corrected.
