---
name: Islandflow Terminal
description: Evidence-linked market intelligence terminal for real-time and replay investigation
colors:
  bg-core: "#06080b"
  bg-elevated: "#0b1016"
  bg-pane: "#111820"
  bg-pane-2: "#0d141b"
  bg-soft: "#ffffff08"
  border-subtle: "#ffffff14"
  border-accent: "#ffb13059"
  text-primary: "#e6edf4"
  text-dim: "#90a0b2"
  text-faint: "#6e7b8c"
  signal-amber: "#f5a623"
  signal-amber-soft: "#f5a6231f"
  confirm-green: "#25c17a"
  confirm-green-soft: "#25c17a1f"
  risk-red: "#ff6b5f"
  risk-red-soft: "#ff6b5f24"
  info-blue: "#4da3ff"
  info-blue-soft: "#4da3ff24"
typography:
  display:
    fontFamily: "Quantico, sans-serif"
    fontSize: "clamp(2rem, 3vw, 2.8rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.08em"
  body:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "0.72rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.12em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-base:
    backgroundColor: "{colors.bg-soft}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  button-active:
    backgroundColor: "{colors.signal-amber-soft}"
    textColor: "{colors.signal-amber}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  nav-link:
    backgroundColor: "{colors.bg-core}"
    textColor: "{colors.text-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  nav-link-active:
    backgroundColor: "{colors.signal-amber-soft}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  pane-surface:
    backgroundColor: "{colors.bg-pane}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "16px 18px"
  status-chip:
    backgroundColor: "{colors.bg-soft}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
---

# Design System: Islandflow Terminal

## Overview

**Creative North Star: "The Evidence Console"**

Islandflow's interface behaves like an investigation instrument, not a presentation layer. The system is tuned for fast read accuracy under volatility: hierarchy is built from contrast, casing, and spacing cadence rather than decorative effects.

The visual atmosphere is dark and controlled, with amber used as a directional signal rather than ambient decoration. Surfaces are compact and information-dense, but each zone is explicit about purpose so the user can move from detection to validation without losing context.

This system explicitly rejects the anti-references in PRODUCT.md: no meme-stock hype aesthetics, no generic SaaS card fog, and no Bloomberg cosplay density unless density is earning its keep with decision value.

**Key Characteristics:**
- Operational contrast over ornamental contrast.
- Dense layout with stable rhythm.
- Accent color treated as scarce signal.
- Monospace-assisted precision for time, numeric, and status data.
- Readability preserved during bursty live updates.

## Colors

The palette is operational and role-first: neutral cold surfaces carry most of the interface, with amber, green, red, and blue reserved for state and meaning.

### Primary

- **Signal Amber** (`#f5a623`): active controls, focus rails, status emphasis, and live interaction highlights.

### Secondary

- **Info Blue** (`#4da3ff`): replay states, neutral directional tags, and non-critical positive context.

### Tertiary

- **Confirm Green** (`#25c17a`): healthy connectivity and positive directional markers.
- **Risk Red** (`#ff6b5f`): stale/disconnected/error states and bearish risk markers.

### Neutral

- **Command Black** (`#06080b`): base shell and deepest background.
- **Panel Graphite** (`#111820`): primary container surfaces.
- **Elevation Slate** (`#0b1016`): raised or overlay-adjacent planes.
- **Data Ink** (`#e6edf4`): default text on dark surfaces.
- **Support Ink** (`#90a0b2`): secondary labels and metadata.
- **Trace Ink** (`#6e7b8c`): tertiary labels and low-priority framing.

### Named Rules

**The Signal Scarcity Rule.** Amber is a control and attention signal, not a wash. Keep it concentrated on actions, state edges, and critical counters.

**The Semantic Color Rule.** Red and green never stand alone for meaning. Every directional or severity cue must include text, shape, or positional confirmation.

## Typography

**Display Font:** Quantico (fallback: sans-serif)
**Body Font:** IBM Plex Sans (fallback: sans-serif)
**Label/Mono Font:** IBM Plex Mono (fallback: monospace)

**Character:** The pairing is technical and composed. Quantico provides assertive waypoint headings, IBM Plex Sans keeps body copy readable, and IBM Plex Mono anchors temporal/numeric trust.

### Hierarchy

- **Display** (700, `clamp(2rem, 3vw, 2.8rem)`, 1.05): page-level and major section titles.
- **Headline** (700, `1.8rem`, 1.1): rail brand mark and high-salience panel titles.
- **Title** (600, `1rem`, 1.2): pane headings and focused section labels.
- **Body** (400, `0.92rem`, 1.45): default transactional and descriptive copy.
- **Label** (600, `0.72rem`, `0.12em`, uppercase): controls, chips, table headers, and instrumentation micro-labels.

### Named Rules

**The Instrument Label Rule.** Labels are short, uppercase, and spaced. They identify system state fast, without narrative phrasing.

## Elevation

The system is flat by default. Depth is primarily tonal (background and border deltas), with shadows reserved for overlays that require separation from live data.

### Shadow Vocabulary

- **Overlay Lift** (`0 24px 60px rgba(0, 0, 0, 0.42)`): filter popovers and floating control surfaces.
- **Drawer Lift** (`0 24px 70px rgba(0, 0, 0, 0.5)`): detail drawers and deep inspection layers.
- **Tooltip Lift** (`0 16px 40px rgba(0, 0, 0, 0.45)`): short-lived contextual tooltips.

### Named Rules

**The Flat-By-Default Rule.** If a surface is not floating over active workflow content, it does not get shadow lift.

## Components

### Buttons

- **Shape:** compact rounded rectangle (`8px radius`) for standard controls, pill (`999px`) for segment toggles.
- **Primary:** subtle dark fill with bordered edge (`1px`, `rgba(255,255,255,0.08)`), label typography in uppercase mono (`0.72rem`).
- **Active State:** amber-tinted gradient/fill (`rgba(245,166,35,0.18 -> 0.08)`), stronger border and warmer text.
- **Focus/Interaction:** no bounce effects; state transitions stay short (`~150-180ms`) with opacity/color emphasis.

### Chips

- **Style:** pill chips (`999px`) with thin border and semantic soft fill.
- **State:** direction/severity/status chips map to green/red/blue semantic channels with text labels always present.

### Cards / Containers

- **Corner Style:** medium-soft corners (`12px` or `14px`) depending on container prominence.
- **Background:** layered dark surfaces (`#111820`, `#0d141b`) with restrained top-to-bottom sheen.
- **Shadow Strategy:** no default card shadow; only overlays and floating inspectors use lift shadows.
- **Border:** subtle perimeter lines (`rgba(255,255,255,0.08)` baseline).
- **Internal Padding:** primarily `16px-18px` with tighter inner rhythm (`8px-12px`) for controls.

### Inputs / Fields

- **Style:** mostly transparent text fields with underlined focus rails for global filter/search workflows.
- **Focus:** amber underline amplification and glow, paired with brighter field text.
- **Error/Disabled:** disabled uses opacity reduction; error state should be paired with label text, not color only.

### Navigation

- **Style:** rail links in uppercase label typography with `10px` radius and low-contrast base fill.
- **Hover/Active:** hover introduces border + subtle fill; active introduces amber-tinted background and stronger contrast.
- **Mobile Treatment:** rail collapses to top flow, controls stack vertically under `720px` while preserving full-width hit targets.

### Signature Component

- **Virtualized Data Tables:** fixed-height row lanes (`36px` and `44px` families), mono numeric columns, semantic row tinting, and stable scroll performance for live bursts.

## Do's and Don'ts

### Do:

- **Do** keep status and direction semantic with both color and text labels (`severity-high`, `direction-bullish`, explicit words).
- **Do** preserve compact control density (`8px-12px` padding range) so investigation actions stay within a short scan path.
- **Do** use amber as a sparse decision signal for active controls, focus rails, and key counters.
- **Do** keep overlays visually separated with dedicated shadow roles while leaving primary panes flat.
- **Do** design live updates to avoid flashing, excessive animation, and layout shifts during high-volume periods.

### Don't:

- **Don't** make Islandflow feel like a meme-stock or finfluencer trading app with hype, gamification, urgency theater, or promotional calls to action.
- **Don't** make Islandflow feel like a generic SaaS analytics dashboard with decorative gradients, vague card stacks, and non-actionable vanity metrics.
- **Don't** make Islandflow feel like Bloomberg-style visual density used as aesthetic cosplay instead of as a genuinely useful information structure.
- **Don't** rely on red/green alone for directional meaning or severity.
- **Don't** use colored side-stripe accents on rows/cards as the primary signifier; use complete semantic chips and labels instead.
