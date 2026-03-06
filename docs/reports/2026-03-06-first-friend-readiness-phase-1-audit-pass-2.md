# First Friend Readiness - Phase 1 Audit Pass 2

> Close the remaining code-level runtime gaps that were still blocking believable friend testing after audit pass 1.

## Summary

Audit pass 2 focused on turning the terminal/runtime surfaces from honest failures into usable fallbacks, while also removing one more macOS-only app-builder path that was still active on every platform. The result is that Phase 1's remaining work is now mostly external validation and release execution, not another pile of obvious code-level cross-platform bugs.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 1`
**Status:** Active
**Created:** 2026-03-06

---

## Hotspots Fixed

1. **Terminal creation no longer dead-ends when `tmux` is missing**
   - Terminal entry stays reachable.
   - Clawchestra now opens a usable temporary direct session instead of a disabled control.
   - Files: `src/components/hub/TypePickerMenu.tsx`, `src/components/hub/TerminalShell.tsx`

2. **In-app tmux remediation now exists on macOS and Linux**
   - The backend now reports OS-appropriate tmux install commands when a supported package manager is available.
   - The terminal surface can launch that remediation flow directly inside a temporary shell.
   - Files: `src-tauri/src/commands/terminal.rs`, `src/lib/tauri.ts`, `src/components/hub/TerminalShell.tsx`

3. **Windows terminals now have a usable fallback path**
   - Windows no longer hard-fails terminal creation.
   - Clawchestra now opens temporary direct PowerShell sessions for friend testing, with explicit messaging that persistence is not there yet.
   - Files: `src/components/hub/TerminalShell.tsx`, `src/components/hub/TypePickerMenu.tsx`

4. **Visible direct terminals no longer get misclassified as dead by the tmux poller**
   - The active visible terminal tab is preserved during liveness refresh even when the session is running without tmux.
   - Files: `src/App.tsx`

5. **macOS-specific menu wiring is now actually macOS-only**
   - The custom guarded Quit menu block is now compiled only on macOS instead of being installed unconditionally.
   - File: `src-tauri/src/lib.rs`

## Remaining Phase 1 Gaps

These are still real, but they are no longer the same class of issue as the earlier audit findings:

1. **Real Windows/Linux runtime validation is still outstanding**
   - The code now has a coherent fallback story, but actual friend-testing on those operating systems is still required.

2. **Window chrome still needs live non-macOS verification**
   - The obvious frontend/menu issues are fixed, but the Tauri window configuration still needs real Windows/Linux confirmation.

3. **GitHub prerelease execution is still unproven**
   - The workflow exists, but no real alpha tag/release run has been exercised yet.

4. **Packaged end-user updater is still not implemented**
   - Packaged installs still rely on manual redownloads and GitHub Releases rather than an in-app release updater.

5. **Windows terminal persistence remains incomplete**
   - Windows is now usable through direct sessions, but not yet equivalent to tmux-backed persistence on Unix-like systems.

## Validation

This pass was validated with:

1. `npx tsc --noEmit`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `pnpm build`
4. `bun test src/lib/chat-normalization.test.ts src/lib/chat-message-identity.test.ts src/lib/gateway.test.ts src/lib/deliverable-lifecycle.test.ts`

## Recommended Next Slice

1. validate window chrome and launch behavior on real Windows and Linux machines
2. execute the GitHub prerelease workflow on a real alpha tag
3. decide whether Windows terminal persistence stays a Phase 1 target or moves to a follow-on terminal-hardening item after friend feedback
