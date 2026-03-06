# First Friend Readiness Manual Actions

> Account-bound and owner-only actions that must be completed before Phase 1 can begin cleanly.

## Summary

This checklist separates true human-required actions from agent-executable work. Anything here either requires ownership of an external account, a billing decision, or an explicit product/publishing choice that should come from the project owner.

Use this as the handoff list between Phase 0 and Phase 1.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Ready
**Created:** 2026-03-05

---

## Required Before Phase 1

### 1. npm scope / org

- [x] Sign in to npm with the account that should own Clawchestra's package namespace
- [x] Attempt to create or claim the org/scope `@clawchestra`
- [x] If unavailable, attempt fallback `@clawchestra-ai`
- [x] Record the result in the claim ledger

Why:

1. this is the only meaningful JS-package namespace claim needed for `npm`, `npx`, `pnpm`, `pnpm dlx`, `bun`, and `bunx`

### 2. Homebrew tap repo

- [x] Create GitHub repo `piercekearns/homebrew-clawchestra`
- [x] Leave it empty or minimal for now; formula/cask content can come later
- [x] Record the result in the claim ledger

Why:

1. Homebrew tap naming is a repo-level claim and can be secured early without publishing a fake package

### 3. Public repo legal posture

- [x] Choose the exact public-repo legal wording
- [x] Either add a license or add an explicit non-open-source/source-visible notice

Why:

1. public visibility without explicit legal posture creates avoidable ambiguity

## Locked Decisions Already Made

These do not need more discussion unless you want to change them:

1. app identifier: `ai.clawchestra.desktop`
2. display/publisher string target: `Clawchestra`
3. full public-repo cleanup before first public push
4. website-first distribution
5. GitHub Releases as public-alpha artifact source of truth
6. Apple Developer Program spend is out of scope for Phase 1; macOS alpha signing/notarization is deferred

## After You Complete The Actions

All owner-side actions listed here are now complete for the current Phase 0 scope.

Phase 0 repo-side cleanup and publication prep are also complete enough to hand off to Phase 1.
