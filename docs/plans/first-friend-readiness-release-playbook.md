# First Friend Readiness - Release Playbook

> Cut public-alpha builds from GitHub Releases without pretending the installer UX is more mature than it is.

## Summary

This playbook is the operational layer for Phase 1 release plumbing. It defines the current alpha release posture, how GitHub Actions is expected to produce artifacts, and what must be true before a build is handed to first-friend testers.

The playbook is intentionally conservative: macOS builds are unsigned for now, packaged release updates are not shipped yet, and GitHub Releases is the canonical source of truth behind the future website download surface.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 1`
**Status:** Active
**Created:** 2026-03-06

---

## Current Release Posture

1. GitHub Releases is the public-alpha artifact source of truth.
2. Release entries are created as draft prereleases first.
3. macOS builds are unsigned in Phase 1 and require explicit trust guidance.
4. Windows and Linux artifacts are first-friend testing builds, not “fully hardened” production installers.
5. `source-rebuild` remains the developer path only.

## GitHub Workflow Surface

Repo workflows now include:

1. `.github/workflows/ci.yml`
   - typecheck
   - frontend build
   - focused regression tests
2. `.github/workflows/release.yml`
   - macOS, Windows, and Linux bundle jobs
   - draft prerelease creation on `app-v*` tags or manual dispatch

## Release Naming

1. Tag format: `app-vX.Y.Z-alpha.N`
2. Release title format: `Clawchestra alpha app-vX.Y.Z-alpha.N`
3. Artifact naming stays Tauri-default until the first live release shows whether overrides are needed.

## Before First Friend Distribution

Confirm all of the following:

1. CI is green on the commit to be tagged.
2. The app identifier is `ai.clawchestra.desktop`.
3. The repo has a configured GitHub remote and the code is pushed so Actions can run from the real repository.
4. Release workflow completed for macOS, Windows, and Linux when a draft prerelease is intentionally cut.
5. Draft release contains expected artifacts:
   - macOS `.dmg`
   - Windows `.msi`
   - Linux `.AppImage`
   - Linux `.deb`
6. Release notes explicitly mention unsigned macOS trust steps.
7. README/install docs match the current alpha reality.
8. The current Phase 1 audit findings do not contain an unacknowledged repo-side cross-platform blocker.

## Unsigned macOS Guidance

Every first-friend macOS release should state plainly:

1. the app is unsigned in the current alpha
2. Gatekeeper may block first launch
3. the tester may need to use System Settings -> Privacy & Security -> Open Anyway after the first blocked attempt

Do not describe the app as notarized or “normal-install friction-free” until that is actually true.

## Manual Repo/Account Checks

Before the first real release run, verify:

1. GitHub Actions is enabled for the repo
2. workflow permissions allow creating releases with `GITHUB_TOKEN`
3. the default branch / push policy matches the workflow triggers
4. release drafts are visible to the owner account
5. the local repository has a remote for `piercekearns/clawchestra`

## Deferred Verification

As of 2026-03-06, the remaining follow-up steps for the public-alpha workflow are:

1. let the current draft prerelease finish publishing its remaining Windows/Linux assets
2. validate the produced artifacts on real Windows and Linux machines during FFR verification/friend-testing

## Not Yet In Scope

These remain outside the current Phase 1 release posture:

1. Apple notarization
2. Windows code signing
3. an in-app packaged release updater
4. website download automation wired to live releases
5. npm/Homebrew bootstrap publishing
