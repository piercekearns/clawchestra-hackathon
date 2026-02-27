---
title: Terminal Colour Scheme Audit & Rebrand
id: terminal-colour-scheme
status: pending
tags: [terminal, theming, ux, design]
icon: "🎨"
nextAction: "Audit all terminal colour tokens; produce visual mockup of app-matched palette; wire to theme toggle"
lastActivity: "2026-02-27"
---

# Terminal Colour Scheme Audit & Rebrand

Audit every colour used across the terminal view, produce a before/after visual comparison with a palette matched to the app's design system, and wire it into the existing dark/light theme toggle.

## Problem

The terminal currently uses default xterm/system colours that don't match the app's neutral + accent palette. When the user switches between the board and the terminal, the colour jump is jarring and makes the terminal feel bolted-on rather than native.

## Deliverables

### 1 — Full Colour Inventory
Enumerate every colour token currently used in the terminal layer:
- Background (main canvas, scrollback)
- Foreground / default text
- ANSI 8-colour set (black, red, green, yellow, blue, magenta, cyan, white)
- ANSI bright variants (16-colour)
- Cursor colour + shape
- Selection highlight
- Link colour
- Scrollbar track/thumb
- Header bar (if present)

### 2 — Visual Mockup (produce this before touching any code)
The mockup should be reviewable by Pierce before any implementation begins. It should show:
- **Before:** screenshot or colour swatch grid of the current xterm default palette in the terminal pane
- **After:** proposed palette matched to app design system, rendered as swatches with hex values:
  - Background → app's `neutral-950` (dark) / `neutral-50` (light)
  - Foreground → app's `neutral-100` / `neutral-800`
  - Accents (green, blue, etc.) → shifted to match Clawchestra's accent hues
  - Error/red → preserve legibility but soften to match app danger colour
- Show the full 16-colour grid (8 standard + 8 bright) for both current and proposed
- Optionally: mock a terminal prompt/output snippet in the proposed palette so it reads naturally

### 3 — Theme Integration
Wire terminal palette to the app's existing dark/light toggle:
- Two palette definitions (`terminalDarkTheme`, `terminalLightTheme`)
- Swap on `themePreference` change
- Persist with the rest of the store

## Implementation Notes

- Terminal is likely using `xterm.js` — palette is set via `ITerminalOptions.theme`
- Look for where `Terminal` is instantiated in `src/components/hub/` — theme object passed there
- Keep ANSI colour semantics intact (e.g. red still = error, green = success) — just remap the exact hex values
