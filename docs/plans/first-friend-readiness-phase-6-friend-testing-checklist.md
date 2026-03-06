# First Friend Readiness Phase 6 Friend Testing Checklist

> Use this checklist to validate the first-friend release on real Windows and Linux machines.

## Summary

Phase 6 is now blocked on real-machine validation, not missing architecture. This checklist defines the minimum friend-testing pass needed to close FFR honestly on Windows and Linux once installers are in testers' hands.

Use it as a scripted handoff: a friend installs the current release, runs through the matrix below, and records any failures or confusing steps. Clawchestra should only be described as fully first-friend ready after these checks run and any resulting bugs are triaged.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 6 - Windows Parity And Final FFR Verification`
**Status:** Ready for external testing
**Created:** 2026-03-06

---

## Test Setup

1. Install the latest GitHub prerelease artifact for the tester's OS.
2. Do not rely on a local source checkout.
3. Record:
   - OS version
   - install artifact used
   - whether OpenClaw is local or remote
   - whether `tmux` is already installed
   - whether a coding-agent CLI is already installed

## Core Matrix

### Install and launch

1. Download the recommended installer/artifact from the website or GitHub release.
2. Launch the app successfully.
3. Note any OS security/trust warnings.
4. Confirm the app reaches onboarding rather than a broken blank state.

### Onboarding

1. Complete onboarding with a local OpenClaw setup if available.
2. Complete onboarding with a remote OpenClaw setup if available.
3. Re-run onboarding from Settings.
4. Confirm the app remains understandable if a project is not added during onboarding.

### OpenClaw chat and sync

1. Test local chat connection if local OpenClaw is available.
2. Test remote chat connection if remote OpenClaw is available.
3. Test sync connection for the configured mode.
4. Confirm error messages are actionable if connection fails.

### Terminal behavior

1. Create a shell terminal.
2. Create a coding-agent terminal if an agent CLI is installed.
3. Close the drawer and reopen it; confirm the terminal session is still there.
4. Fully quit Clawchestra and relaunch it; confirm the Windows terminal session reattaches if testing on Windows.
5. On macOS/Linux, confirm missing `tmux` remediation is understandable if `tmux` is absent.
6. Confirm action-required/unread output indicators still behave sensibly.

### Remote OpenClaw support

1. Use the generated remote install command on the remote OpenClaw host if testing remote sync.
2. Confirm the remote support endpoint is reachable afterward.
3. Confirm the manual fallback path is understandable if the one-command path cannot be used.

## Findings Format

For each issue, record:

1. OS and installer used
2. local or remote OpenClaw
3. exact step that failed
4. what the tester expected
5. what actually happened
6. screenshot or terminal output if available

## Exit Condition

Phase 6 can be treated as ready for human verification only after:

1. at least one real Windows tester runs this checklist
2. at least one real Linux tester runs this checklist
3. any critical or high-severity findings are fixed or explicitly accepted
