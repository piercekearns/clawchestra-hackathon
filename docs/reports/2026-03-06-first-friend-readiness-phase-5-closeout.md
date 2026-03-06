# First Friend Readiness Phase 5 Closeout

> Build the thin website install/download layer on top of the real release pipeline without drifting into the broader marketing-site item.

## Summary

Phase 5 adds the first real website install surface for Clawchestra. Instead of building a speculative marketing site, the repo now ships a static download layer in `website/` that detects the visitor's OS, reads the latest GitHub release metadata at runtime, recommends the correct artifact, and exposes the full asset matrix plus release notes.

The implementation is intentionally narrow: release/download correctness belongs to FFR, while broader storytelling and visual expansion still belong to the `clawchestra-ai-website` item. The new site can deploy immediately via GitHub Pages and later be mounted behind `clawchestra.ai` or absorbed into the broader website build.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 5 - Website Integration`
**Status:** Built — awaiting verification
**Created:** 2026-03-06

---

## Shipped

1. Added a static website surface under `website/`.
2. Added runtime GitHub release resolution so the site reads the latest published release/asset metadata directly from GitHub instead of duplicating artifact definitions.
3. Added OS detection and platform-aware primary download selection for macOS, Windows, and Linux.
4. Kept the full asset matrix visible so users can still choose a different artifact manually.
5. Added a GitHub Pages deployment workflow so the install surface can be published without waiting for the broader marketing site.
6. Kept the website/FFR ownership boundary explicit in the docs so the eventual `clawchestra-ai-website` implementation reuses this install surface rather than rebuilding it separately.

## Validation

1. `bun test website/release-data.test.js`
2. `npx tsc --noEmit`
3. `pnpm build`
4. `jq empty .clawchestra/state.json`

## Non-Goals / Carry-Forwards

1. This is not the full branded/public marketing site; that remains with `clawchestra-ai-website`.
2. The static install surface currently depends on live GitHub API availability at runtime; if the API is unavailable, it falls back to the GitHub Releases page.
3. Custom domain wiring for `clawchestra.ai` is not done here.
4. Windows terminal persistence and real Windows/Linux friend-testing remain final-phase FFR work, not website work.

## Exit Criteria Check

1. Website is a routing layer over working releases. `Met locally.`
2. Users can install from the website without understanding the repo. `Met for the current thin install surface.`
3. Website copy matches the actual release/update behavior. `Met locally.`
4. Overlap with `clawchestra-ai-website` is explicit. `Met in docs and code structure.`
