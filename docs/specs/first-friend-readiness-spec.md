# First Friend Readiness

> Make Clawchestra installable, onboardable, and fully usable by a new user on macOS, Linux, and Windows.

## Summary

First Friend Readiness is no longer just "make it work on a friend's machine." It is the productization pass that turns Clawchestra from an owner-shaped local tool into something another person can discover, install, launch, connect, and use without already knowing the repo, the runtime, or the hidden dependencies. The work now spans five linked surfaces: release distribution, public-alpha repo hygiene, OpenClaw connection and sync architecture, onboarding, and terminal/runtime dependency readiness.

This spec is aligned to the current codebase. Clawchestra already has a settings page, remote sync settings, Add Existing/onboarding compatibility flows, agent guidance injection, an OpenClaw extension installer primitive, system-context generation, and embedded terminal infrastructure. FFR should build on those pieces instead of re-specifying them as if they do not exist.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Ready
**Created:** 2026-02-19
**Updated:** 2026-03-06

---

## 1. Success Criteria

FFR is successful when all of the following are true:

1. A new user can install Clawchestra from a website-first flow on macOS, Linux, or Windows using a native artifact for their OS.
2. A new user can also choose a documented source-build path for developer use.
3. On first launch, Clawchestra guides the user through setup instead of silently dropping them into an incomplete state.
4. The user can connect Clawchestra to either a local OpenClaw instance or a remote OpenClaw deployment they host differently from the project owner.
5. The user can import or create projects without hand-authoring raw metadata files unless they explicitly choose to.
6. The user can create and use embedded terminals as part of the default product experience.
7. If a required terminal dependency is missing, Clawchestra either ships it or offers a one-click install/remediation path that unblocks the user immediately.
8. The repo and shipped app no longer leak owner-specific defaults, paths, or setup assumptions into the public-alpha experience.
9. The website is only a presentation layer over release/distribution capabilities that already exist underneath it.

## 2. Product Definition

FFR covers four user types:

| User | What they need |
|---|---|
| Friend using a local OpenClaw install | Install app, connect locally, discover projects, use chat and terminals |
| Friend using remote OpenClaw on VPS/Tailscale/other host | Install app, configure remote chat transport and sync, understand capability tradeoffs |
| Friend on macOS/Linux/Windows | Native install path and OS-appropriate runtime behavior |
| Developer/power user | Optional source-build and source-rebuild workflow |

FFR does not mean "open source forever." It means the product can survive a public-alpha GitHub phase cleanly. If the repo is public but not open-source licensed, that must be explicit in the repo posture and release docs.

## 2.1 Known Inputs

The following are now known and should be treated as baseline assumptions for FFR:

1. The public website domain is `clawchestra.ai`.
2. The GitHub repo name is reserved at `piercekearns/clawchestra`.
3. The website should be the primary install surface.
4. Embedded terminals are part of default Clawchestra functionality.
5. The app should move to a non-personal, stable application identifier before the first public installable build.
6. End-user updates should be treated separately from the existing developer-oriented `source-rebuild` flow.

## 2.2 Working Assumptions

Unless explicitly changed before implementation, FFR should proceed with these assumptions:

1. **Stable app identifier:** `ai.clawchestra.desktop`
2. **Primary website:** `https://clawchestra.ai`
3. **Release backend:** GitHub Releases on `piercekearns/clawchestra`
4. **Default end-user update model:** packaged release artifacts, not source checkout
5. **Developer update model:** keep `source-rebuild` as an advanced/dev-only mode
6. **Preferred release artifacts:**
   - macOS: `.dmg`
   - Windows: `.msi`
   - Linux: `.AppImage` plus `.deb`
7. **CLI/package posture:** claim namespace-level assets early where there is little or no cost and no placeholder-package downside; only publish registry packages when there is a real install surface behind them
8. **Public-alpha repo posture:** source-visible public alpha with explicit docs; no implicit promise that the project will remain open source long-term
9. **macOS alpha release posture:** unsigned public-alpha installers are acceptable for now, but install/trust guidance must be explicit until signing/notarization exists

## 3. Distribution Principles

### Website-first, GitHub-backed

The website should be the primary installation surface. GitHub Releases should be the authoritative artifact store for first-friend and hackathon distribution.

The layering should be:

1. CI builds and publishes signed or unsigned release artifacts.
2. GitHub Releases stores those artifacts and release notes.
3. The website detects OS and offers the best install option first.
4. Optional CLI install flows point at the same release primitives, not a separate distribution system.

### Distribution channels

| Channel | Role in FFR | Notes |
|---|---|---|
| Website download page | Primary entry point | OS detection, native artifact selection, release notes, install instructions |
| GitHub Releases | Source of truth for artifacts | Required for public-alpha sharing and website download wiring |
| Source build | Advanced/developer path | Explicitly documented, not the default friend path |
| CLI install/bootstrap | In scope as a channel decision | Package names should be claimed early even if v1 ships only a thin installer/bootstrap command |

### Paid-product distribution posture

FFR should assume the future paid product is installed primarily through native, non-terminal desktop flows:

1. website download -> native installer/artifact
2. direct GitHub Releases download during public alpha
3. optional future app-store or managed-package channels if the product later needs them

CLI/package-manager install paths are still valuable, but they should be treated as secondary convenience channels for technical users, automation, and developer workflows unless Clawchestra later ships a genuine CLI/bootstrap product that justifies them as a first-class install surface.

### Bootstrap package rule

FFR should not block release readiness on a CLI/bootstrap package.

The rule should be:

1. native website-first installers are mandatory
2. a CLI/bootstrap package may ship in FFR if it is a real install surface that downloads, validates, or launches the correct desktop install flow
3. if the bootstrap package would be a placeholder or low-value wrapper, it should be deferred until after native release plumbing is stable

### Artifact matrix

| OS | Preferred artifact | Secondary artifact | Update posture |
|---|---|---|---|
| macOS | `.dmg` | direct app zip if needed | End-user release-updater later; source-rebuild remains advanced/dev-only |
| Windows | `.msi` or NSIS `.exe` | zip portable only if necessary | End-user release-updater later; no source checkout required |
| Linux | `.AppImage` and/or `.deb` | tarball only if necessary | End-user release-updater later; distro-specific docs if needed |

During the current public-alpha Phase 1, macOS should be treated as:

1. unsigned installer path
2. manual trust steps documented in release notes and README
3. acceptable for first-friend testing, but not acceptable to describe as polished desktop distribution

### Update model

There are two different update stories and FFR must stop conflating them:

1. **End-user update**: the user installed a release artifact and should receive future app updates from release artifacts.
2. **Developer update**: the user cloned the source and wants the current `source-rebuild` workflow.

**Recommendation:** treat release-artifact updates as the real end-user path, and keep `source-rebuild` as an advanced developer mode. The current `source-rebuild` flow is valuable, but it is not the right default for most first friends.

## 4. Public-Alpha Repo And Release Hygiene

FFR now includes a mandatory sanitization pass before public GitHub push or first public-alpha release.

### Must be scrubbed or normalized

1. Owner-specific defaults and placeholders in shipped UI and settings.
2. Absolute local paths in docs that do not need to be public.
3. Repo instructions that assume one developer's toolchain or directory layout.
4. Terminal dependency hints that are macOS-only when the app claims cross-platform support.
5. Any seeded configuration that only exists to make Clawchestra work on one machine.

### Identity policy

Clawchestra should choose its final non-personal application identifier before the first public build that users install.

Why this matters:

1. Tauri's identifier scopes app storage, WebView storage, preferences, and updater continuity.
2. Changing the identifier after users install creates migration work and duplicate app identities.
3. It is cheaper to choose the final identifier now than after the first shared builds are in the wild.

### Repo posture for public alpha

FFR should explicitly decide and document:

1. Final reverse-DNS app identifier.
2. Public-repo posture: open source license, source-available/all-rights-reserved, or another explicit legal stance.
3. Which package names and domains need to be claimed now.
4. Which docs are public-facing versus internal-only.

## 4.2 Release Operations Reality

FFR should describe the current release posture honestly:

1. GitHub Releases is the artifact source of truth for public alpha.
2. Release automation should create draft prereleases before wider sharing.
3. macOS builds are unsigned until Apple signing/notarization is funded and configured.
4. Windows and Linux artifacts should be described as friend-testing builds until the Phase 1 audit and tester feedback loop have run.
5. A release playbook and a whole-codebase audit checklist are required Phase 1 artifacts, not optional notes.

## 4.1 Package And Namespace Claiming Strategy

Not every ecosystem has a clean "reserve this name now" concept.

FFR should treat package/name claiming in three buckets:

1. **Already-owned assets**
   - domain (`clawchestra.ai`)
   - GitHub repo (`piercekearns/clawchestra`)
2. **Namespace assets that can be claimed cleanly now**
   - npm user/org scope if available
   - Homebrew tap repo naming
   - other repo/namespace-level channels that do not require a fake shipped package
3. **Registry entries that should wait for a real package**
   - WinGet manifests
   - Chocolatey community packages
   - Homebrew formula/cask entries tied to actual release artifacts
   - unscoped npm package names if the only reason to publish would be squatting

### Working recommendation

1. Claim clean namespace-level assets now where cost/risk is low.
2. Track installer/package names now in the Phase 0 checklist.
3. Publish a package during FFR only if it is a legitimate minimal bootstrap package with real install value.
4. Do not publish placeholder packages solely to hold a name.

### Claiming support model

FFR should explicitly include claim management support rather than assuming the human will work it out ad hoc.

For each claimable surface, FFR should produce and maintain:

1. the proposed name
2. whether the channel is primary, secondary, or deferred
3. whether the claim can be executed automatically, by CLI, or only in a website UI
4. the expected cost or billing posture
5. the account owner of record
6. the renewal/recovery path
7. the current claim status

The implementation workflow should be:

1. Clawchestra/agent prepares the recommendation and exact steps.
2. The agent executes what can be executed safely from the repo/runtime side.
3. The human performs any account-bound web claims that cannot be automated here.
4. The result is written back into a claim ledger so ownership and management stay legible later.

## 5. Default Functionality And Runtime Dependencies

Embedded terminals are part of default Clawchestra functionality. FFR cannot defer them to "advanced users."

### Product requirement

When a user clicks to create a terminal, one of two things must happen:

1. The terminal opens and is usable immediately.
2. Clawchestra presents a one-click remediation flow that installs or enables the missing dependency, then returns the user directly to terminal creation.

A dead disabled state with a manual brew-only hint is not first-friend ready.

### Dependency policy

| Dependency | Current reality | FFR requirement |
|---|---|---|
| `tmux` | Required for embedded terminals today | Bundle it if feasible; otherwise provide OS-specific one-click install from the app |
| Agent CLI (`claude`, `codex`, `opencode`, etc.) | Optional per terminal type | Detect, explain, and offer install/remediation where practical |
| OpenClaw CLI/runtime | Required for chat/sync integration | Onboarding must either auto-detect/setup or provide guided remediation |

### Lifecycle action policy

The default lifecycle actions cannot assume Claude Code + tmux forever. FFR should define:

1. A default preset that works for a newly installed Clawchestra instance.
2. Behavior when Claude Code is unavailable.
3. Behavior when tmux is unavailable.
4. A path from defaults to later full customization.

## 6. OpenClaw Architecture Alignment

The old FFR spec treated "OpenClaw setup" as one thing. In the current codebase it is at least two things and must be specified that way.

### 6.1 Chat transport

This is how Clawchestra talks to OpenClaw for chat.

Required settings surface:

1. WebSocket URL (`ws://` or `wss://`)
2. Authentication token
3. Session key
4. Connection test and clear failure states

This must support:

1. Local OpenClaw auto-detection
2. SSH-tunnel/local-loopback remote use
3. Direct remote `wss://` setups
4. Explicit explanation when a remote deployment changes capability expectations

### 6.2 Sync transport

This is how Clawchestra syncs orchestration state with OpenClaw.

Current code already distinguishes:

1. Local sync via `~/.openclaw/clawchestra/db.json`
2. Remote sync via HTTP endpoint + bearer token

FFR must not re-invent that. It must finish the product layer around it:

1. Wizard/setup UX
2. Extension installation or guided remediation
3. Health/status display
4. Clear explanation of what works in Local vs Remote sync mode

### 6.3 Extension and system-context bootstrapping

Current code already has primitives for:

1. Installing the Clawchestra data endpoint extension
2. Generating extension content for manual installation
3. Writing `~/.openclaw/clawchestra/system-context.md`

FFR should incorporate those into onboarding and health UX rather than leaving them as backend-only capabilities.

### 6.4 Capability transparency

The onboarding flow should clearly explain the difference between:

1. **Local OpenClaw**: full local loop, direct local sync, local file adjacency
2. **Remote OpenClaw**: remote planning/chat/sync, but code execution remains local through embedded terminals

This is not an error state. It is a product mode difference the user should understand.

## 7. Onboarding

FFR onboarding should reuse and extend current settings and project-import flows, not replace them with a greenfield wizard detached from the existing code.

### First-run flow

Recommended flow:

1. **Welcome + access transparency**
   Clarify what Clawchestra will and will not do.
2. **Connect to OpenClaw**
   Local or remote chat transport setup, plus sync-mode setup.
3. **Install or validate required OpenClaw support**
   Extension setup, system-context status, connection health.
4. **Choose project roots / import projects**
   Reuse existing scan path and Add Existing compatibility logic.
5. **Validate terminal readiness**
   Detect tmux and available agent CLIs. If something required is missing, offer remediation now.
6. **Ready state**
   Land the user on a working board with chat and terminals available.

### Onboarding rules

1. No silent incomplete state on first launch.
2. No assumption that the user knows the original developer's filesystem layout.
3. No assumption that the user knows SSH, port forwarding, or tmux beforehand.
4. If the user must take an action, it should be presented in-app with copy/paste or one-click remediation.
5. Existing installs should bypass onboarding automatically but be able to re-run it.

## 8. Current Codebase Alignment

### Already exists and should be reused

1. Settings page and persisted settings surface
2. Remote sync settings (`Local` / `Remote` / `Disabled`)
3. Add Existing compatibility and onboarding flow
4. Guidance injection during project add
5. OpenClaw extension installer primitive
6. System-context generation on startup
7. Agent detection and terminal infrastructure

### Exists but is incomplete for FFR

1. Chat transport still resolves from local OpenClaw config rather than explicit runtime settings.
2. `source-rebuild` updater is macOS-only and developer-oriented.
3. Tauri bundle targets now cover the target OS set, but live release execution and artifact validation are still pending.
4. Terminal persistence still prefers user-installed tmux, but the app now falls back to direct sessions and offers in-app tmux remediation instead of a dead-end disabled state.
5. Lifecycle prompts are now tool-neutral, but packaged-installer/update UX and real cross-platform validation are still incomplete.

### Explicit cross-platform reality

FFR does **not** assume the current app already works correctly on Windows or Linux once packaged.

The current product is still visibly macOS-shaped in a few important places:

1. Title bar and window chrome assumptions
2. Updater behavior and app replacement flow
3. Path defaults and home-directory assumptions
4. Shell/process assumptions in runtime tooling
5. Terminal dependency hints and remediation copy

Cross-platform adaptation is therefore part of FFR itself, not a post-FFR packaging exercise.

FFR also requires a **whole-codebase cross-platform review**, not just fixes for the currently known hotspots. The known macOS-shaped areas are starting points, not the full audit boundary.

### Missing for FFR

1. First-run onboarding shell
2. Cross-platform release automation
3. Website download layer
4. Public-alpha scrub checklist and docs
5. End-user release update path
6. One-click dependency remediation for terminal readiness
7. Cross-platform runtime hardening for non-macOS installs

## 9. Recommended Delivery Order

### Phase 0: Identity, Repo Hygiene, And Distribution Decisions

1. Lock final non-personal app identifier before first public build.
2. Decide repo posture for public alpha.
3. Claim package names/domains needed for website and CLI distribution.
4. Create a release/distribution matrix and public scrub checklist.

### Phase 1: Release Plumbing

1. Add GitHub release automation for macOS, Linux, and Windows artifacts.
2. Expand Tauri bundle targets per OS.
3. Add first public install docs and release notes discipline.
4. Keep source-build docs as an advanced path.
5. Fix cross-platform runtime gaps so packaged installs actually behave correctly on Windows/Linux.

### Phase 2: OpenClaw Transport And Sync Productization

1. Separate chat transport settings from sync settings in product copy and runtime behavior.
2. Add explicit chat connection settings and health test.
3. Integrate extension/system-context status into setup flow.
4. Make local vs remote capability differences legible in UI.

### Phase 3: First-Run Onboarding

1. Trigger onboarding on missing settings / incomplete setup.
2. Reuse current settings and Add Existing flows inside a guided shell.
3. Land users in a working state, not a partially configured board.

### Phase 4: Terminal Readiness And Default Lifecycle Behavior

1. Bundle tmux or provide one-click install/remediation.
2. Expand tool detection across supported OSes.
3. Make lifecycle defaults usable without assuming Claude Code everywhere.

### Phase 5: Website Integration

1. Build the website on top of the already-working release matrix.
2. Use the website to route users to the right artifact or CLI bootstrap command.
3. Keep the website as a thin visual layer over release infrastructure, not the place where release logic lives.

## 10. Out Of Scope

These are not required to call FFR complete:

1. Multi-device sync UX polish beyond what current sync architecture already supports
2. Deep lifecycle button customization UI beyond what is needed to avoid broken defaults
3. Full marketplace/provider abstraction for non-OpenClaw AI backends
4. Mobile support
5. Final long-term commercial packaging and licensing strategy beyond public-alpha clarity
