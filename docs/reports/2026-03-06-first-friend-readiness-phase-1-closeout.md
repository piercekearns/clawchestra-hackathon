# First Friend Readiness - Phase 1 Closeout

> Repo-side Phase 1 hardening is in place; Phase 2 is unblocked, and the remaining release/test work continues as a parallel follow-up track.

## Summary

This report closes the local engineering portion of Phase 1 as far as it can be completed from the current machine. The release scaffold exists, the app now builds locally with `npx tauri build --no-bundle`, tmux fallback/remediation is in place, macOS-only window chrome has been split out of the cross-platform base config, and the repository is now pushed to GitHub.

Phase 1 is complete enough to start Phase 2. The remaining work is no longer local implementation cleanup. It is release-execution and real-machine validation follow-through: a live GitHub prerelease run and real Windows/Linux artifact testing once testers are available.

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
3. Real GitHub Actions release creation, because the local repo currently has no configured remote and no pushed live workflow to execute.
4. Real end-user installer behavior for `.msi`, `.AppImage`, and `.deb` artifacts.

## Identifier Resolution

The previously chosen identifier `ai.clawchestra.app` produced a Tauri warning because identifiers ending in `.app` conflict with the macOS application bundle extension.

That issue is now resolved by moving to `ai.clawchestra.desktop`.

## Remaining Phase 1 Follow-Up

These are the only remaining known follow-up items from Phase 1:

1. **Push the repo and run a real draft prerelease**
   - The repo is now pushed to GitHub, so the remaining step is to cut the first real draft prerelease from a live workflow run.
2. **Validate the first draft release on real Windows and Linux machines**
   - The current environment cannot prove real non-macOS launch behavior.
   - Friend-testing remains necessary, but it no longer blocks beginning Phase 2 work.

## Recommended Next Move

1. Cut the first `app-v...` draft prerelease.
2. Test the resulting Windows and Linux artifacts on real machines when testers are available.
3. Start Phase 2 in parallel.
