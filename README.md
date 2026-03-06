# Clawchestra

> Source-visible public alpha for an agent-native desktop orchestration app.

Clawchestra is a Tauri desktop app for managing projects, roadmap items, chat workflows, and embedded coding terminals in one place. The current repo state is a public alpha preparation branch: install/distribution polish, cross-platform hardening, and onboarding work are still in progress.

## Repo Status

This repository is currently **source-visible** so the project can be shared with early testers and used in public demos.

Unless a separate license file says otherwise:

1. this repository is **not open source**
2. the code is provided for visibility and evaluation during the alpha period
3. all rights are reserved
4. you may not copy, modify, redistribute, or create derivative works from this code except as allowed by law or by explicit written permission

## Current Focus

The active productization track is `first-friend-readiness`, which is making Clawchestra:

1. installable on macOS, Linux, and Windows
2. usable with local or remote OpenClaw setups
3. onboardable for new users without owner-specific setup assumptions

## Install Status

Clawchestra is not yet at its first public installable release.

The planned release posture is:

1. website-first downloads via `clawchestra.ai`
2. GitHub Releases as the alpha artifact source of truth
3. native installers as the primary end-user path
4. source-build as a developer-only path

The Phase 1 release scaffold now assumes this artifact matrix:

| OS | Primary artifact | Notes |
|---|---|---|
| macOS | `.dmg` | Public-alpha builds are currently unsigned and require manual trust steps |
| Windows | `.msi` | Early friend-testing installer |
| Linux | `.AppImage` and `.deb` | Early friend-testing artifacts |

Embedded terminal posture in the current alpha:

1. macOS and Linux terminals prefer persistent tmux-backed sessions
2. if `tmux` is missing, Clawchestra now offers in-app remediation from the terminal surface and can still fall back to a temporary direct shell
3. Windows terminals currently run as temporary PowerShell sessions while tmux-backed persistence remains under Phase 1 hardening

Current release operations docs:

1. `docs/plans/first-friend-readiness-release-playbook.md`
2. `docs/plans/first-friend-readiness-phase-1-audit-checklist.md`

## Contact

For access, demos, or permissions, contact the project owner directly.
