# First Friend Readiness - Phase 1 Closeout

> Repo-side Phase 1 hardening is in place; Phase 2 is unblocked, and the remaining release/test work continues as a parallel follow-up track.

## Summary

This report closes the local engineering portion of Phase 1 as far as it can be completed from the current machine. The release scaffold exists, the app now builds locally with `npx tauri build --no-bundle`, tmux fallback/remediation is in place, macOS-only window chrome has been split out of the cross-platform base config, and the repository is now pushed to GitHub.

Phase 1 is complete enough to start Phase 2. The remaining work is no longer local implementation cleanup. The first live GitHub draft prerelease now exists with published macOS, Linux, and Windows artifacts. Real Windows/Linux install testing is deferred to the FFR verification pass once testers are available.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 1`
**Status:** Active
**Created:** 2026-03-06

---

## What Was Completed In This Pass

1. Re-ran local validation after the terminal/runtime hardening work:
   - `npx tsc --noEmit`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `pnpm build`
   - `bun test src/lib/chat-normalization.test.ts src/lib/chat-message-identity.test.ts src/lib/gateway.test.ts src/lib/deliverable-lifecycle.test.ts`
   - `npx tauri build --no-bundle`
2. Split macOS-only title bar settings out of the cross-platform Tauri base config:
   - base config now keeps only cross-platform window settings
   - macOS overlay title bar settings now live in `src-tauri/tauri.macos.conf.json`
3. Fixed CI trigger drift by allowing pushes from both `master` and `main`.
4. Re-checked release workflow readiness and recorded the remaining external follow-up steps explicitly.

## What The Local Validation Proved

1. The app still compiles and packages locally after the Phase 1 runtime hardening changes.
2. The repo is ready for a real GitHub prerelease workflow once it exists on GitHub and has Actions enabled.
3. Windows/Linux configuration is materially safer than before because macOS-only title bar settings are no longer applied globally from the base config.

## What The Local Validation Could Not Prove

1. Real Windows launch, title bar, and shell behavior.
2. Real Linux launch, title bar, and shell behavior.
3. Real end-user installer behavior for `.msi`, `.AppImage`, and `.deb` artifacts.

## Identifier Resolution

The previously chosen identifier `ai.clawchestra.app` produced a Tauri warning because identifiers ending in `.app` conflict with the macOS application bundle extension.

That issue is now resolved by moving to `ai.clawchestra.desktop`.

## Remaining Phase 1 Follow-Up

These are the only remaining known follow-up items from Phase 1:

1. **Validate the first draft release on real Windows and Linux machines**
   - The current environment cannot prove real non-macOS launch behavior.
   - Friend-testing remains necessary and is explicitly deferred to FFR verification rather than treated as a pre-Phase-2 gate.

## Recommended Next Move

1. Test the published Windows and Linux artifacts on real machines during FFR verification when testers are available.
2. Start Phase 2 in parallel.
