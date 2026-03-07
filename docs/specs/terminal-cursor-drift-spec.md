# Terminal Cursor Position Drift & Rendering Bugs

> Fix embedded terminal rendering issues: cursor drift, missing/overlapping lines, and line ordering glitches.

## Summary

The embedded xterm.js terminals exhibit several rendering issues that do not occur in native terminal emulators like Ghostty. These affect daily usability, particularly with interactive CLI tools like Claude Code and Codex.

---

**Roadmap Item:** `terminal-cursor-drift`
**Status:** Draft
**Created:** 2026-02-25
**Updated:** 2026-03-07

---

## Observed Symptoms

### 1. Cursor position drift
The prompt input bar intermittently floats mid-screen instead of anchoring to the bottom. Most noticeable when using Claude Code CLI inside embedded terminals. Does not occur in Ghostty.

### 2. Missing / overlapping lines
Lines of CLI output are sometimes missing entirely, overlap each other, or render in the wrong order. This happens with both Claude Code and Codex, suggesting it is a terminal rendering issue rather than a per-CLI issue.

### 3. Line ordering glitches
Output that should appear sequentially sometimes renders out of order, with newer content appearing above older content or interleaved incorrectly.

## Root Cause Hypotheses

- **xterm.js fit addon timing:** The fit addon may not be recalculating dimensions correctly after resize events, causing xterm.js to think the terminal is a different size than it actually is. This mismatch between xterm.js's internal state and the PTY dimensions could cause cursor drift.
- **PTY dimension sync:** When the terminal panel resizes (layout changes, drawer open/close, window resize), the PTY may not receive updated dimensions in time, causing the running process to write output for the wrong terminal size.
- **tmux intermediate layer:** Terminals run inside tmux for session persistence. tmux adds its own dimension tracking layer. If xterm.js, tmux, and the inner process disagree on dimensions, rendering breaks.
- **Rapid output buffering:** When CLI tools produce large amounts of output quickly (e.g. Claude Code streaming a response), xterm.js may not render intermediate frames correctly, leading to missing or overlapping lines.

## Ghostty as Reference Implementation

Ghostty (https://github.com/ghostty-org/ghostty) is an open-source terminal emulator that handles all of these scenarios correctly. Key areas to investigate in the Ghostty source:

- **Terminal grid/screen management:** How Ghostty maintains its internal screen buffer and ensures cursor position stays consistent during resizes
- **PTY dimension synchronization:** How Ghostty propagates window size changes to the PTY (timing, debouncing, ordering)
- **Reflow behavior:** How Ghostty handles line reflow when terminal width changes (xterm.js reflow is known to have edge cases)
- **Rendering pipeline:** How Ghostty ensures output is rendered in the correct order even under high-throughput streaming
- **Resize handling:** Whether Ghostty uses any techniques to pause/buffer output during resize transitions to prevent torn frames

The goal is not to replicate Ghostty's renderer (it's GPU-accelerated native code) but to learn from its PTY synchronization, resize handling, and buffer management patterns that could be applied to our xterm.js + tmux + Tauri PTY stack.

## Investigation Plan

1. **Reproduce reliably:** Document exact steps to trigger each symptom (cursor drift, missing lines, line overlap)
2. **Instrument dimensions:** Log xterm.js rows/cols, tmux dimensions, and PTY dimensions on every resize to find where they diverge
3. **Audit fit addon usage:** Check timing of `fitAddon.fit()` calls relative to container resize events and PTY dimension updates
4. **Study Ghostty source:** Review Ghostty's PTY and resize handling for applicable patterns
5. **Test without tmux:** Run terminals without the tmux persistence layer to isolate whether tmux is contributing to the rendering issues
6. **xterm.js version audit:** Check if newer xterm.js versions have fixed relevant reflow/rendering bugs

## Files Likely Affected

| File | Change |
|------|--------|
| Terminal component (xterm.js setup) | Fit addon timing, resize event handling |
| `src-tauri/src/commands/terminal.rs` | PTY dimension sync, resize propagation |
| tmux session management | Dimension negotiation with inner PTY |

## Open Questions

1. Are the missing/overlapping lines only visible or are they actually lost from the terminal buffer?
2. Does the issue correlate with specific resize events (e.g. sidebar toggle, layout orientation change)?
3. What xterm.js version are we on, and are there known reflow bugs fixed in newer versions?
4. Does disabling tmux persistence eliminate the rendering issues?
