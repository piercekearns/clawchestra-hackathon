# First Friend Readiness Phase 6 Implementation Pass 2

> Move Windows terminal persistence out of the foreground app process so sessions can survive Clawchestra relaunch.

## Summary

This pass finishes the remaining architecture gap from implementation pass 1. Windows terminal sessions are now owned by a detached local host mode of the Clawchestra binary instead of the foreground desktop process, which gives the app a client/server-style reattach model on Windows without introducing WSL or an external mux dependency.

That materially changes the remaining Phase 6 scope. The outstanding work is no longer "design relaunch persistence." It is now real-machine verification on Windows and Linux, plus any fixes that external testing surfaces.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 6 - Windows Parity And Final FFR Verification`
**Status:** In Progress
**Created:** 2026-03-06

---

## Delivered

1. Added a detached local host mode to the Clawchestra binary for Windows terminal session ownership.
2. Added a localhost authenticated IPC layer between the foreground desktop app and the detached host.
3. Moved the Windows persistent-session commands to proxy through that detached host instead of foreground Tauri state.
4. Updated quit-guard logic so active Windows persistent sessions are counted even though they now live outside the foreground process.
5. Updated startup entrypoints so the binary can run either as the desktop app or as the detached terminal host.

## Validation

Passed locally:

1. `npx tsc --noEmit`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `bun test src/lib/terminal-launch.test.ts src/lib/deliverable-lifecycle.test.ts`
4. `pnpm build`
5. `npx tauri build --no-bundle`

Additional attempted validation:

1. Installed `x86_64-pc-windows-msvc` target with `rustup target add x86_64-pc-windows-msvc`
2. Attempted `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`

That Windows cross-check was still blocked by the current Mac host toolchain while compiling `ring`, so it did not provide a true Windows-target confirmation of the Clawchestra crate.

## Remaining Gaps

The remaining Phase 6 work is now environment-bound rather than architecture-bound:

1. Run real Windows-machine validation of:
   - install
   - onboarding
   - chat
   - sync
   - terminal create/detach/reattach/relaunch
2. Run real Linux-machine validation of the same FFR matrix.
3. Triage and fix any issues those tests expose.

## Recommendation

1. Treat this detached-host path as the new Windows baseline.
2. Do not reopen the architecture question unless real Windows testing exposes a concrete failure mode in this design.
3. Treat friend-testing and validation triage as the remaining Phase 6 gate before FFR can honestly be called complete.
