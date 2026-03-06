# First Friend Readiness Phase 3 Closeout

> Build the first-run onboarding shell on top of the current settings and project-import machinery.

## Summary

Phase 3 turned onboarding into a real product surface instead of an implied README/setup task. Fresh installs now land in a guided onboarding shell, existing installs continue to bypass it by default, and Settings can re-run the same flow later without resetting tracked project state.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 3 - Onboarding Shell`
**Status:** Built — awaiting verification
**Created:** 2026-03-06

---

## Shipped

1. Added a persisted `onboardingCompleted` settings flag so new installs can be detected cleanly while legacy installs remain opted out by default.
2. Added a dedicated onboarding shell that guides users through:
   - welcome/access transparency
   - settings-backed OpenClaw and scan-path setup
   - project creation/import via the existing Add Project wizard
   - terminal readiness explanation
   - completion back to the board
3. Added a Settings entry point to re-run onboarding later.
4. Upgraded Settings so the OpenClaw support section can:
   - install the local extension
   - refresh/write system context
   - refresh support status
   - copy extension content for manual or remote setup
5. Allowed the Add Project dialog to be reused from onboarding rather than only from the board.

## Validation

1. `npx tsc --noEmit`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `pnpm build`
4. `bun test src/lib/chat-normalization.test.ts src/lib/chat-message-identity.test.ts src/lib/gateway.test.ts src/lib/deliverable-lifecycle.test.ts`
5. `npx tauri build --no-bundle`

## Non-Goals / Carry-Forwards

1. Remote OpenClaw extension installation is still a manual/copy path; the app now surfaces that path clearly, but the guided remote-install productization is intentionally carried into Phase 4.
2. Real Windows/Linux friend-testing remains deferred to the broader FFR verification pass.
3. Phase 4 still owns the deeper terminal-default/productization questions beyond the readiness guidance now shown in onboarding.

## Exit Criteria Check

1. Fresh install lands in a guided setup flow. `Met locally.`
2. Onboarding ends in a usable board state. `Met locally; users can finish with projects added or explicitly defer project import.`
3. Existing installs are not regressed. `Met by defaulting legacy installs to onboarding-complete unless they re-run it manually.`
4. Add Existing compatibility, migration, and guidance injection are preserved. `Met by reusing the existing Add Project flow instead of replacing it.`
