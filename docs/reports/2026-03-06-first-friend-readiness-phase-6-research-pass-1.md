# First Friend Readiness Phase 6 Research Pass 1

> Establish the evidence-backed direction for Windows terminal persistence before implementation starts.

## Summary

This first Phase 6 pass focused on the architecture question, not the implementation. The research outcome is that Clawchestra should not treat Windows persistence as a small UI fix, and it should not default to WSL or a bundled third-party mux just because Unix currently gets persistence from tmux. The current front-runner is a Clawchestra-owned persistent terminal manager in Rust, built on top of the PTY stack already in use.

This matters because Clawchestra already has the correct low-level primitive on Windows: `tauri-pty` uses `portable-pty`, and `portable-pty` uses ConPTY on Windows. The missing layer is persistent session ownership, attach/detach semantics, and buffered replay in the backend.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 6 - Windows Parity And Final FFR Verification`
**Status:** Research pass complete
**Created:** 2026-03-06

---

## Sources Used

Primary/external:

1. Microsoft `CreatePseudoConsole` docs
2. Microsoft pseudoconsole session guidance
3. Microsoft ConPTY introduction blog
4. WezTerm multiplexing documentation

Current stack / local source:

1. `tauri-plugin-pty` source in the local cargo registry
2. `portable-pty` source in the local cargo registry
3. Clawchestra terminal code in `src/components/hub/TerminalShell.tsx` and `src/lib/terminal-launch.ts`

## Key Findings

1. Windows already has the right PTY primitive in the current stack.
   - `portable-pty` uses ConPTY on Windows.
   - `tauri-plugin-pty` sits on top of that and already stores sessions in backend state.

2. The current problem is session ownership, not PTY availability.
   - today the UI effectively owns terminal lifetime
   - on Windows the result is a temporary PowerShell process with no reconnect semantics

3. ConPTY does not solve persistence for us.
   - it gives pseudoconsole I/O and process hosting
   - Clawchestra must own detach/reattach, buffering, lifecycle, and cleanup if it wants persistence

4. An external mux is possible, but expensive in product complexity.
   - WezTerm-style muxing is real, but it introduces a larger dependency and packaging story
   - that may be attractive later, but it is not the obvious FFR answer

5. WSL + tmux should remain a fallback only.
   - it is not honest out-of-the-box Windows support

## Provisional Architecture Recommendation

Recommended direction:

1. Build a Clawchestra-owned persistent terminal manager in Rust.
2. Reuse the current PTY layer (`tauri-pty` / `portable-pty`) rather than replacing it.
3. Add product-level session concepts:
   - stable terminal session IDs
   - backend-owned lifetime
   - attach/detach
   - bounded replay buffer
   - cleanup policy

## Why This Beats The Alternatives

1. It preserves one Clawchestra session model across platforms.
2. It avoids forcing Windows users into WSL.
3. It avoids bundling a full external mux/runtime just to get persistence.
4. It builds on the stack already proven inside the app.

## Immediate Next Step

Write the concrete implementation plan for this architecture before coding begins.
