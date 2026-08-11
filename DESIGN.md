---
name: Ficha Técnica de Bar
description: Dark-panel bar-costing console for Vale Verde Festas — insumos, recipe costing, and CMV/margin dashboard.
colors:
  bg: "#0f1115"
  panel: "#171a21"
  panel-2: "#1e222b"
  border: "#2a2f3a"
  text: "#e8eaed"
  muted: "#8a90a0"
  accent: "#d4a24c"
  accent-2: "#6ea8ff"
  good: "#3ecf8e"
  warn: "#e0b23e"
  bad: "#e05555"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "normal"
    letterSpacing: "normal"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "normal"
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "normal"
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "normal"
    letterSpacing: "0.04em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#1c1f26"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  button-danger:
    backgroundColor: "{colors.bad}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  badge-good:
    backgroundColor: "rgba(62,207,142,0.15)"
    textColor: "{colors.good}"
    rounded: "{rounded.lg}"
    padding: "2px 8px"
  badge-warn:
    backgroundColor: "rgba(224,178,62,0.15)"
    textColor: "{colors.warn}"
    rounded: "{rounded.lg}"
    padding: "2px 8px"
  badge-bad:
    backgroundColor: "rgba(224,85,85,0.15)"
    textColor: "{colors.bad}"
    rounded: "{rounded.lg}"
    padding: "2px 8px"
  card-receita:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "14px"
  stat-tile:
    backgroundColor: "{colors.panel-2}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: Ficha Técnica de Bar

## Overview

**Creative North Star: "The Bar Ledger"**

Ficha Técnica de Bar reads as a financial instrument, not a menu. It's a dark-panel console built for one operator moving fast through many rows of ingredients, recipes, and margins before an event — closer in spirit to a trading terminal or a night-shift back-office tool than to hospitality branding. Depth comes entirely from tonal layering (near-black background → panel → panel-2) and 1px borders; there are no shadows, gradients, or decorative flourishes anywhere in the system.

Color is a signal, not decoration. Bar Brass (the gold accent) marks the one primary action or active state on any given view and stays rare by design. Focus Blue marks calm secondary emphasis — input focus, the Enigma quadrant — and never competes with gold for attention. Everything else, which is most of the interface, sits in neutral grays. Status (good/caution/alert) is expressed exclusively through a tinted-pill badge recipe, never through arbitrary color choices elsewhere.

This is deliberately **not** the Vale Verde Festas / Florest brand world — the elegant, nature-lit, romantic aesthetic documented for the Florest venue and its Clareira signature cocktail belongs to a different, customer-facing surface. This tool is internal and operational; it should never borrow that palette or mood. The quadrant emoji (⭐🐴❓🍍) in the menu-engineering view are functional shorthand for a serious dashboard, not an invitation toward a playful or gamified visual style.

**Key Characteristics:**
- Dark-by-default, flat, no shadows — depth via background tone and border only.
- One rare accent color (Bar Brass) for primary actions and active state; a second, calmer accent (Focus Blue) for secondary signals only.
- Status color is expressed only through the tinted-pill badge pattern, never ad hoc.
- Dense, compact type (11–20px) — built for scanning many rows, not for spacious editorial reading.
- Distinct from, and never blended with, the Florest/Clareira brand world.

## Colors

A near-black neutral scale carries almost the entire interface; two accents and three status colors are spent sparingly and only when they mean something.

### Primary
- **Bar Brass** (`#d4a24c`): the one primary-action / active-state color. Used on the active tab underline and label, the primary `.btn`, and nowhere else. Text on Bar Brass is a fixed dark ink (`#1c1f26`), not the theme's dark-mode text token, so it stays legible in both color schemes.

### Secondary
- **Focus Blue** (`#6ea8ff`): calm secondary signal. Used only for the 1px focus outline on inputs/selects/textareas and as the Enigma quadrant's identifying color. Never used as a second primary-action color.

### Neutral
- **Deep Ink** (`#0f1115`): page background (dark mode).
- **Charcoal Panel** (`#171a21`): the base surface for header, tabs, tables, cards, and modals — one tone up from Deep Ink.
- **Slate Panel** (`#1e222b`): the surface one tone up from Charcoal Panel, used for inputs, stat tiles, and the secondary button — signals "recessed/interactive" against the flatter Charcoal Panel.
- **Graphite Border** (`#2a2f3a`): the sole edge/divider treatment across the system — table rows, cards, inputs, modals. There is no shadow equivalent; this border *is* the separation device.
- **Paper White** (`#e8eaed`): primary text (dark mode).
- **Muted Slate** (`#8a90a0`): secondary text — labels, table headers, helper copy, inactive tabs.

### Status
- **Confirmed Green** (`#3ecf8e`): good CMV/margin, the Estrela (star) quadrant.
- **Caution Amber** (`#e0b23e`): borderline CMV/margin, the Cavalo de batalha quadrant. Distinct from Bar Brass — do not conflate the two golds; Caution Amber is a status signal, Bar Brass is an action signal.
- **Alert Red** (`#e05555`): bad CMV/margin, destructive actions (`.btn.danger`, delete icon hover).

### Light mode (OS-triggered variant)
`prefers-color-scheme: light` swaps only the neutral scale — accents and status colors stay fixed in both schemes:

| Token | Dark (canonical) | Light |
|---|---|---|
| bg | `#0f1115` | `#f5f6f8` |
| panel | `#171a21` | `#ffffff` |
| panel-2 | `#1e222b` | `#f0f1f4` |
| border | `#2a2f3a` | `#dde1e8` |
| text | `#e8eaed` | `#1c1f26` |
| muted | `#8a90a0` | `#6b7280` |

### Named Rules
**The One Gold Rule.** Bar Brass appears on at most one interactive element's resting state per view (the active tab, or the primary button in a toolbar/modal). If a screen needs a second strong color, reach for Focus Blue or a status color — never a second use of Bar Brass.

**The Tinted Pill Rule.** Status is only ever shown as a pill: 15% opacity of the status color as background, the full-strength status color as text, `{rounded.lg}` radius. No other component may use raw status-color fills.

## Typography

**Body/UI Font:** -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif (system-native stack; no custom webfont, no separate display or mono face)

**Character:** A plain OS-native system font, used at small, dense sizes throughout. The typography does no personality work by itself — voice and hierarchy come entirely from size, weight, color, and letter-spacing, not from font choice.

### Hierarchy
- **Headline** (700, 20px): the single app title in the header (`🍸 Ficha Técnica de Bar`). Appears once.
- **Title** (700, 18px): inline-editable entity names — the recipe/production name input at the top of a modal.
- **Body** (400, 13px): the default size for nearly everything — table cells, form inputs, buttons, card rows, toolbar text.
- **Label** (600, 11–14px, uppercase, 0.04em letter-spacing): section labels (`h2`), quadrant labels (`.me-quad h3`), stat-tile captions (`.indicador span`), muted/secondary micro-copy. Always paired with Muted Slate color.

### Named Rules
**The No-Display Rule.** Nothing in this system is display-sized. The largest text is the 20px header title; resist the urge to introduce a hero/display size even for empty states or onboarding — this tool never needs to shout.

## Layout

A single centered column, `max-width: 1200px`, padded `20px 24px 60px`, sitting under a full-width sticky header + tab bar. Toolbars are a flex row (`gap: 12px`, wrapping) where the last child is pushed right via `margin-left: auto` — the consistent pattern for "search/filter on the left, primary action on the right."

Content areas use CSS grid where items are peers: the recipe list (`auto-fill, minmax(220px, 1fr)`), the four-stat indicator row (`repeat(4, 1fr)`), and the 2×2 menu-engineering quadrant (`1fr 1fr`). Tables scroll horizontally inside a bordered `table-wrap` rather than reflowing; the Insumos table additionally breaks out of the `1200px` column cap and scrolls vertically inside its own bounded `table-wrap` (`max-height: calc(100vh - 190px)`) so its column header stays sticky and visible over the full 224+ row list — the one tab dense enough to need this.

Modals are centered overlays (`rgba(0,0,0,.55)` scrim, no blur) capped at `720px` wide and `90vh` tall with independently sticky header/footer and a scrolling body. Where a modal has KPI-style stat tiles (the recipe editor's cost/CMV/markup/margin row), they sit directly below the field that drives them and stay sticky under the modal header while the rest of the body scrolls — the computed answer stays on screen with the input that produces it.

**Observed gap:** one basic breakpoint (`max-width: 768px`) stacks the header, collapses form grids to a single column, and drops the 4-tile indicator row to 2 columns — enough that the app doesn't break on a phone, but nothing here is mobile-first or reflows the dense Insumos table into cards. Treat this as current state, not an invariant to preserve; `/impeccable adapt` is the right command to take it further deliberately.

## Elevation & Depth

Fully flat. There is not a single `box-shadow` anywhere in the system. Depth is conveyed only two ways: **tonal layering** (Deep Ink → Charcoal Panel → Slate Panel, each one step lighter, signals "further forward / more interactive") and **1px borders** (Graphite Border) marking every edge. Modals separate from the page via a flat black scrim, not a shadow.

### Named Rules
**The Flat-By-Default Rule.** Never add a `box-shadow`, glow, or blur to signal elevation. If something needs to read as "above" or "in front of" the rest of the page, move it one step up the bg → panel → panel-2 tone ramp, or give it a border.

## Shapes

Radii scale in four steps and correlate with a component's "weight": `6px` for small interactive controls (inputs, buttons), `8px` for mid-weight containers (table-wrap, stat tiles), `10px` for cards and the status-pill badge, `12px` for the modal — the single largest surface in the system. Corners get rounder as surfaces get bigger, never the reverse.

The one recurring non-radius shape device is the **4px colored left border** used on the menu-engineering quadrant panels (`.me-quad`) — a flag/tab affordance that ties a container to a semantic color without filling its whole surface.

## Components

### Buttons
- **Shape:** `6px` radius, `8px 14px` padding, `13px/600` label text.
- **Primary:** Bar Brass background, fixed dark-ink text (`#1c1f26`) — the one gold surface per view.
- **Secondary:** Slate Panel background, Paper White text, `1px solid` Graphite Border — the default choice for any non-primary action.
- **Danger:** Alert Red background, white text — reserved for destructive actions (delete recipe/production).
- **Icon button:** transparent, Muted Slate at rest, shifts to Alert Red on hover — used for close (✕) and other single-glyph controls; the hover color itself communicates "this is a dismiss/delete-adjacent action" even before the click.

### Badges
- **Style:** tinted pill — 15% opacity status-color background, solid status-color text, `10px` radius, `2px 8px` padding, `12px/700` text. See The Tinted Pill Rule.
- **Neutral variant:** Slate Panel background with default text color, used before a status is determined.
- **CMV/status badges** additionally prefix a symbol (`✓`/`!`/`✕`) before the value — status must never ride on color alone.

### Cards (Receita cards)
- **Corner style:** `10px` radius.
- **Background:** Charcoal Panel, `1px solid` Graphite Border.
- **Depth:** none — flat at rest.
- **Hover:** border color shifts to Bar Brass (150ms transition); no lift, no shadow. This is the system's only hover-affordance pattern for clickable containers.
- **Internal padding:** `14px`.

### Inputs / Fields
- **Style:** Slate Panel background, `1px solid` Graphite Border, `6px` radius, `7px 10px` padding, `13px` text.
- **Focus:** `1px solid` Focus Blue outline — no glow, no shadow, no border-color change. This is the system's one and only focus treatment; apply it identically everywhere a field can be focused.
- **Error state:** the unit-mismatch warning (`.unidade-aviso.aviso-unidade`) turns its adjacent helper text Alert Red and bold — inline text color, not a bordered/boxed error state.

### Navigation (Tabs)
- **Style:** flat text buttons in a row, Muted Slate at rest, `2px` transparent bottom border.
- **Active:** Bar Brass text and bottom border, `600` weight — the tab bar is one of the two places Bar Brass is allowed to appear at rest (the other is the primary button).

### Stat Tile (`.indicador`)
- Slate Panel background, `1px solid` Graphite Border, `8px` radius, `10px 12px` padding. An uppercase Muted Slate Label caption above a `19px/700` value — the one place in the system where a number is sized up past Body, because these are the computed answers (CMV, margin) the rest of the screen exists to produce. Always appears in a row of related tiles (e.g. the four cost/CMV/markup/margin tiles), never alone.

### Menu-Engineering Quadrant (signature component)
A 2×2 grid of quadrant panels classifying recipes by sales volume × margin (the classic star/workhorse/puzzle/dog matrix, given Brazilian bar-culture names): ⭐ Estrela, 🐴 Cavalo de batalha, ❓ Enigma, 🍍 Abacaxi. Each panel is a Charcoal Panel card with a `4px` colored left border matching its semantic status color (Estrela → Confirmed Green, Cavalo → Caution Amber, Enigma → Focus Blue, Abacaxi → Alert Red), an emoji-prefixed heading, and a list of recipe rows separated by dashed 1px dividers. This is the system's most distinctive component — the left-border-as-flag pattern used here is the template for any future "categorize into N semantic buckets" view.

## Do's and Don'ts

### Do:
- **Do** keep Bar Brass rare — one primary action or active state per view (The One Gold Rule).
- **Do** express all status exclusively through the tinted-pill badge recipe (The Tinted Pill Rule).
- **Do** convey elevation only through the bg → panel → panel-2 tone ramp and 1px Graphite Borders (The Flat-By-Default Rule).
- **Do** use the `4px` colored-left-border pattern when a future view needs to classify items into semantic buckets, matching the Menu-Engineering Quadrant precedent.
- **Do** keep type small and dense (11–20px); this is a scanning tool.

### Don't:
- **Don't** add `box-shadow`, glow, blur, or gradient anywhere — nothing in the current system uses them.
- **Don't** apply the Vale Verde Festas / Florest / Clareira brand world (nature imagery, soft elegant palette) to this tool's UI — they are deliberately separate surfaces.
- **Don't** let the quadrant emoji pull the system toward a playful, colorful, or gamified visual style — they're functional labels on a serious financial dashboard.
- **Don't** use Focus Blue as a second primary/action color; it is reserved for focus rings and the Enigma quadrant only.
- **Don't** confuse Bar Brass (action color) with Caution Amber (status color) — they are visually close but semantically distinct and must never substitute for each other.
