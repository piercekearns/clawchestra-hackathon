# First Friend Readiness Phase 6 Implementation Pass 1

> Build the first Windows persistence layer, then record the remaining gap honestly.

## Summary

This pass replaces the old temporary Windows PowerShell fallback with a Clawchestra-owned backend session manager that keeps Windows terminal sessions alive while the app remains open. It does not yet solve full app-relaunch persistence, because the session host still lives inside the Clawchestra process rather than a detached helper.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 6 - Windows Parity And Final FFR Verification`
**Status:** In Progress
**Created:** 2026-03-06

---

## Delivered

1. Added a Rust-managed persistent terminal session registry for Windows.
2. Added Tauri commands for:
   - ensure/create session
   - attach with buffered replay
   - drain live output
   - capture hidden-session scrollback
   - write, resize, kill
   - list active session IDs
3. Switched the Windows terminal frontend path from direct PTY lifetime to backend-managed attach/detach.
4. Updated app liveness and hidden-activity polling so Windows sessions participate in the same terminal-status model as tmux-backed Unix sessions.
5. Updated quit-guard logic so Windows persistent sessions count as active sessions.

## Validation

Passed locally:

1. `npx tsc --noEmit`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `bun test src/lib/terminal-launch.test.ts src/lib/deliverable-lifecycle.test.ts`
4. `pnpm build`
5. `npx tauri build --no-bundle`

Additional verification:

1. Installed the Windows Rust target with `rustup target add x86_64-pc-windows-msvc`
2. Attempted `cargo check --target x86_64-pc-windows-msvc`

That Windows compile-only check was blocked by the host machine's missing cross C toolchain headers while compiling `ring`, so it did not reach the Clawchestra crate. This means the Windows-specific Rust path still lacks a true compile confirmation from this machine.

## Remaining Gap

The remaining material FFR gap is:

1. **Full relaunch persistence on Windows**

Current behavior:

1. close drawer -> session survives
2. reopen drawer -> session reattaches
3. quit/relaunch app -> session does not survive yet

Why:

1. the session host currently lives inside the Clawchestra app process
2. when the app process exits, the Windows pseudoconsole host exits with it

What is still needed:

1. a detached helper/host process or equivalent externalized session owner
2. real Windows machine validation
3. final Linux/Windows friend-testing pass

## Recommendation

1. Keep this implementation as the new baseline; it removes the worst Windows terminal UX gap immediately.
2. Do not call Phase 6 complete yet.
3. Treat detached-host relaunch persistence plus real-machine testing as the remaining Phase 6 work needed before FFR can be called complete.
