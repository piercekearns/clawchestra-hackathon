# First Friend Readiness - Phase 1 Audit Pass 1

> Fix the concrete cross-platform runtime assumptions that can be removed in-code before friend testing starts.

## Summary

This audit pass focused on code-paths that would actively misbehave or mislead users outside the original macOS/source-install environment. The goal was not to declare cross-platform support finished; it was to remove the obvious Unix-only and owner-shaped assumptions that would make Phase 1 artifact work untrustworthy.

The result is a narrower remaining Phase 1 problem: terminal remediation, live GitHub release execution, and real Windows/Linux validation now stand out as the real gaps, rather than being mixed together with avoidable in-code assumptions.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 1`
**Status:** Active
**Created:** 2026-03-06

---

## Audit Scope

This pass reviewed and adjusted these surfaces:

1. backend path/home/temp handling
2. OpenClaw config and CLI discovery
3. updater posture and temp/log paths
4. terminal runtime behavior and dropped-file handling
5. title-bar spacing assumptions
6. lifecycle prompt assumptions for build/plan/review flows

## Hotspots Fixed

1. **Backend home-directory assumptions**
   - Replaced direct `HOME` environment dependence in default scan paths, OpenClaw config/auth/profile lookups, slash-command discovery, and tilde expansion with `dirs`-based resolution.
   - Files: `src-tauri/src/lib.rs`, `src-tauri/src/util.rs`

2. **Command discovery assumptions**
   - Added cross-platform command lookup helpers so OpenClaw and coding-agent detection no longer assume a Unix login shell only.
   - Windows now uses `where`; Unix keeps login-shell lookup.
   - Files: `src-tauri/src/util.rs`, `src-tauri/src/commands/terminal.rs`, `src-tauri/src/lib.rs`

3. **Updater misdirection on non-macOS**
   - Non-macOS builds no longer advertise or detect `source-rebuild` updates as if they were supported.
   - Update lock/log paths now use the platform temp directory instead of hardcoded `/tmp`.
   - Files: `src-tauri/src/commands/update.rs`, `src/hooks/useAppUpdate.ts`, `update.sh`, `src/components/SettingsForm.tsx`, `src-tauri/src/lib.rs`

4. **Title-bar spacing**
   - The traffic-light spacer in the custom title bar is now macOS-only instead of shifting the layout on every OS.
   - File: `src/components/TitleBar.tsx`

5. **Terminal runtime safety**
   - Terminal startup now fails gracefully when tmux is missing, when the project path is unavailable, or when the user is on Windows where the current tmux-backed shell path is not wired yet.
   - Drag-and-drop file staging no longer hardcodes `/tmp`; it now uses a backend temp-file writer.
   - Files: `src/components/hub/TerminalShell.tsx`, `src/components/hub/TypePickerMenu.tsx`, `src/lib/tauri.ts`, `src-tauri/src/lib.rs`

6. **Lifecycle prompt assumptions**
   - Build/plan/review prompts no longer hardcode “Claude Code via tmux” as the default execution model.
   - Files: `src/lib/deliverable-lifecycle.ts`, `src/lib/deliverable-lifecycle.test.ts`

## Remaining Phase 1 Gaps

These are still real, but they were not cleanly solvable in this pass without broader feature work or external execution:

1. **One-click terminal remediation is still missing**
   - The app now fails clearly when tmux is unavailable, but it still does not install or remediate tmux for the user.

2. **Windows embedded terminals are still not shipped as a valid experience**
   - They now fail safely instead of trying to run Unix shell glue, but this is still a product gap, not a finished feature.

3. **Tauri window chrome still needs real non-macOS validation**
   - The frontend spacing issue is fixed, but the underlying `titleBarStyle` / `hiddenTitle` / traffic-light config still needs actual Windows/Linux runtime validation.

4. **Packaged release execution has not been exercised yet**
   - CI/release workflows exist, but no real GitHub prerelease run has been executed in this pass.

5. **Packaged end-user updater is still not implemented**
   - `source-rebuild` remains macOS/dev-only. That is now honest in code and UI, but still incomplete from an end-user product perspective.

## Validation

This pass was validated with:

1. `npx tsc --noEmit`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `pnpm build`
4. `bun test src/lib/chat-normalization.test.ts src/lib/chat-message-identity.test.ts src/lib/gateway.test.ts src/lib/deliverable-lifecycle.test.ts`

## Recommended Next Slice

1. implement terminal dependency remediation flow
2. continue the audit on window chrome and process/runtime surfaces that require real Windows/Linux confirmation
3. execute the GitHub prerelease workflow on a real alpha tag
