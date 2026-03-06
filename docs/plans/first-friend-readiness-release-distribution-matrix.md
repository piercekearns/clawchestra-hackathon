# First Friend Readiness Release And Distribution Matrix

> Define the install surfaces, artifact expectations, update posture, and manual prerequisites for first-friend public alpha.

## Summary

This matrix turns FFR distribution decisions into an operational artifact. It states which install channels are primary, which are optional, which require real installers before they make sense, and what manual prerequisites exist behind each one. The website is intentionally treated as a front-end over this matrix, not as the system of record.

Use this in Phase 0 and Phase 1 to avoid inventing release channels ad hoc.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Ready
**Created:** 2026-03-05

---

## Channel Matrix

| Channel | Audience | Priority In FFR | Backing Artifact / Surface | Update Posture | Manual Requirements | Notes |
|---|---|---|---|---|---|---|
| `clawchestra.ai` download page | all users | primary | links to GitHub Releases artifacts | points users to current release | domain already owned; site implementation later | primary visual install surface |
| GitHub Releases | all alpha users | primary | versioned release artifacts + notes | canonical source of truth for alpha updates | repo must be public enough to distribute artifacts | website should consume this, not replace it |
| macOS `.dmg` | macOS end users | primary | native desktop installer | future packaged release updates | Apple signing/notarization decision; DMG build/release plumbing | first friend install should not require terminal |
| macOS `.zip` fallback | macOS technical users | secondary | direct app bundle archive | manual re-download if needed | signing posture still matters | useful fallback if DMG has friction |
| Windows `.msi` | Windows end users | primary | native desktop installer | future packaged release updates | signing decision; Windows build/release plumbing | preferred Windows first-friend path |
| Windows portable `.zip` | Windows technical users | secondary | unpack-and-run fallback | manual re-download if needed | same artifact provenance concerns as MSI | only if MSI friction remains |
| Linux `.AppImage` | Linux end users | primary | portable desktop artifact | manual or future packaged updates | Linux build pipeline; distro docs if needed | broadest Linux alpha artifact |
| Linux `.deb` | Debian/Ubuntu users | primary | native package | manual or future packaged updates | packaging/release plumbing | complements AppImage |
| source build | developers / contributors | supported but non-default | repo checkout + toolchain | `source-rebuild` remains dev-only | Node/Rust/Tauri toolchains | do not present as first-friend default |
| CLI/bootstrap package | technical users | optional | real bootstrap installer only | should route to release-backed install flow | only ship if package provides real install value | do not publish placeholder package |
| Homebrew tap | macOS technical users | optional later | formula/cask backed by real release artifact | brew upgrade once real package exists | tap repo creation; formula/cask work | namespace can be claimed before package ships |
| WinGet | Windows users | deferred until real Windows installer exists | manifest for real installer | winget upgrade after publication | real installer metadata and submission | not a reservation-only channel |
| Chocolatey | Windows technical users | deferred until real Windows installer exists | package for real installer | choco upgrade after publication | package publish + moderation | not worth doing before Windows artifacts exist |

## Default Posture

1. Primary first-friend flow: website -> native installer
2. Alpha artifact source of truth: GitHub Releases
3. Developer path: source build
4. Optional technical convenience: CLI/bootstrap package only if it is real and useful

## Recommendation Defaults

Unless explicitly changed, FFR should proceed with these recommendations:

1. legacy/internal docs get a full public-repo cleanup before first public push
2. bundle/product metadata uses `Clawchestra` as the non-personal display string where possible
3. macOS Phase 1 assumes unsigned alpha artifacts with explicit install/trust guidance because Apple Developer Program spend is out of scope for now
4. Windows code-signing is valuable but should not block earliest alpha packaging if certificate overhead is disproportionate
5. one real npm-backed bootstrap package can later cover `npm`, `pnpm`, `npx`, `bun`, `pnpm dlx`, and `bunx` if we decide it is worth shipping

## Manual Requirements By Phase

### Before or during Phase 1

1. decide public-alpha signing posture for macOS and Windows artifacts
2. decide publisher metadata string for desktop bundles/installers
3. decide whether GitHub Releases remain public-alpha distribution backend or whether a parallel private artifact host is needed later
4. confirm that full public-repo cleanup is required before first public push

### After native artifact plumbing exists

1. decide whether a real CLI/bootstrap package is worth shipping
2. decide whether Homebrew/WinGet/Chocolatey should be added as convenience channels
3. decide whether app-store channels matter at all for the paid product

## FFR Rule

The website does not create distribution capability. It only presents the channels that this matrix says already exist.
