# First Friend Readiness - Phase 1 Audit Checklist

> Use this checklist to prove Clawchestra is genuinely cross-platform, not just cross-compiled.

## Summary

Phase 1 is not complete when CI can emit a Windows or Linux artifact. It is complete when the codebase has been reviewed systematically for platform assumptions, the known risks are recorded, and the first-friend builds handed to testers have a clear install and recovery path.

This checklist turns the broad “whole-codebase audit” requirement into concrete review buckets. Each bucket should produce findings or an explicit “reviewed, no issue found” note before non-macOS friend testing is treated as meaningful.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 1`
**Status:** Active
**Created:** 2026-03-06

---

## Audit Outputs

Each audit pass should leave behind:

1. files or modules reviewed
2. findings with severity and file references
3. decisions taken immediately vs deferred
4. validation done locally vs deferred to friend testing
5. gaps that still require a real Windows or Linux machine

## Review Buckets

### 1. Packaging and artifact assumptions

Check:

1. Tauri bundle targets and icons
2. installer metadata and artifact naming
3. release workflow OS matrix
4. GitHub Releases draft semantics and notes
5. unsigned macOS messaging for public alpha

### 2. Windowing and title-bar behavior

Check:

1. `titleBarStyle`, `hiddenTitle`, and traffic light positioning
2. custom title-bar assumptions that only make sense on macOS
3. minimum-size and layout constraints under Windows/Linux window chrome
4. drag regions and resize affordances

Primary files:

1. `src-tauri/tauri.conf.json`
2. `src/components/TitleBar.tsx`
3. `src/App.tsx`

### 3. Path, filesystem, and home-directory handling

Check:

1. `~/...` expansion assumptions
2. slash vs backslash handling
3. drive-letter handling on Windows
4. temp/log/cache path assumptions
5. writable-location assumptions for bundled installs

Primary files:

1. `src-tauri/src/lib.rs`
2. `src-tauri/src/state.rs`
3. `src/components/SettingsForm.tsx`
4. `src/lib/*` path-sensitive helpers

### 4. Shell and process execution

Check:

1. `/bin/sh` assumptions
2. executable-bit assumptions
3. process spawning that differs across OSes
4. quoting rules for paths with spaces
5. availability of `git`, `tmux`, and other binaries on PATH

Primary files:

1. `src-tauri/src/commands/update.rs`
2. `src-tauri/src/commands/terminal.rs`
3. `src-tauri/src/commands/git.rs`
4. any shell-invoking helper in `src-tauri/src/lib.rs`

### 5. Update and install posture

Check:

1. current `source-rebuild` flow is clearly dev-only
2. packaged-install users are not pointed at source-only flows
3. update UI copy does not imply a shipped packaged updater yet
4. install docs match actual release artifacts
5. macOS trust guidance is present for unsigned alpha builds

Primary files:

1. `src/lib/settings.ts`
2. `src/components/SettingsForm.tsx`
3. `src-tauri/src/commands/update.rs`
4. `README.md`
5. release docs/workflows

### 6. Terminal dependency readiness

Check:

1. terminal creation gating when `tmux` is missing
2. copy and remediation flows on macOS, Linux, and Windows
3. one-click install/remediation plan vs graceful block state
4. any hardcoded platform-specific package-manager advice
5. session lifecycle assumptions that are Unix-only

Primary files:

1. `src/components/hub/TypePickerMenu.tsx`
2. `src/lib/deliverable-lifecycle.ts`
3. `src-tauri/src/commands/terminal.rs`
4. `src/App.tsx`

### 7. OpenClaw and networking assumptions

Check:

1. local-host defaults and loopback assumptions
2. path assumptions in config discovery
3. socket/transport behavior that may differ across platforms
4. remote-host wording in setup and troubleshooting copy

Primary files:

1. `src/lib/gateway.ts`
2. `src/lib/settings.ts`
3. `src/components/SettingsForm.tsx`
4. `src-tauri/src/lib.rs`
5. `src-tauri/src/sync.rs`

### 8. Onboarding and docs

Check:

1. first-run setup copy does not assume the repo is cloned
2. docs match actual release state
3. recovery steps exist for missing dependencies and unsigned installers
4. public docs do not assume macOS-only flows

Primary files:

1. `README.md`
2. `docs/plans/first-friend-readiness-release-distribution-matrix.md`
3. onboarding/import docs and flows
4. settings UI copy

### 9. Test and validation coverage

Check:

1. existing tests assume generic paths and environments
2. release workflows validate what they claim to validate
3. Phase 1 produces a list of Windows/Linux items that can only be closed by external testers

Primary files:

1. `src/**/*.test.ts*`
2. `.github/workflows/*.yml`
3. Phase 1 reports/checklists

## Exit Gate

Before calling the Phase 1 audit complete, produce:

1. a findings report for the whole-codebase audit
2. a list of issues fixed during the audit
3. a list of issues intentionally deferred to later FFR phases
4. a list of issues requiring tester confirmation on Windows or Linux
