# First Friend Readiness Phase 0 Checklist

> Lock the public-alpha decisions and hygiene work before implementation begins.

## Summary

This checklist is the preflight gate for First Friend Readiness. It exists to keep Phase 1 implementation from starting on unstable ground. The goal is to lock the app identity, public-alpha repo posture, release/distribution assumptions, and obvious owner-specific leaks before release plumbing and onboarding work begin.

Use this as the execution checklist for FFR Phase 0.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Ready
**Created:** 2026-03-05

---

## Locked Working Assumptions

1. Website domain: `clawchestra.ai`
2. GitHub repo: `piercekearns/clawchestra`
3. Website-first distribution
4. Embedded terminals are mandatory default functionality
5. Developer updates keep `source-rebuild`
6. End-user installs should use packaged release artifacts
7. Preferred artifact defaults:
   - macOS: `.dmg`
   - Windows: `.msi`
   - Linux: `.AppImage` plus `.deb`
8. Final app identifier: `ai.clawchestra.desktop`
9. Public repo posture: source-visible public alpha with explicit docs and no implicit promise of long-term open-source status
10. Package-name strategy: actively claim clean namespace-level assets now; avoid publishing placeholder registry packages solely to reserve names
11. Bootstrap package rule: do not block FFR on a CLI/bootstrap package; ship one only if it provides real install value

## Checklist

### A. Identity

- [x] Final app identifier confirmed
- [ ] Deep rename follow-up implications reviewed for new identifier
- [ ] Tauri storage/update continuity risk accepted before first public build

### B. Public-Alpha Repo Posture

- [x] Public repo wording drafted
- [x] License or explicit non-open-source notice chosen
- [x] Public-facing docs vs internal-only docs identified
- [x] Sensitive/personalized files identified before first push

### C. Owner-Specific Surface Audit

- [x] Shipped UI placeholders audited
- [x] Default workspace path audited
- [x] Default scan path placeholders audited
- [x] Default app source path placeholders audited
- [x] Terminal dependency copy audited for cross-platform correctness
- [x] Personal absolute paths audited in public docs/tests

### D. Release And Distribution

- [x] Artifact matrix locked
- [x] GitHub Releases chosen as artifact source of truth
- [x] Website download flow mapped to release artifacts
- [x] Source-build path explicitly marked advanced/developer-only
- [x] End-user update posture recorded separately from `source-rebuild`

### E. Naming / Ownership

- [x] Domain ownership recorded (`clawchestra.ai`)
- [x] GitHub repo ownership recorded (`piercekearns/clawchestra`)
- [x] Candidate package names listed for reservation/claiming
- [x] Namespace-level assets identified for immediate claiming
- [x] Registry package names identified that should wait for real artifacts
- [x] Any naming conflicts or unavailable channels documented
- [x] Claim ledger created with owner, cost, renewal, recovery, and status for each channel
- [x] Channels that require user web-account action are separated from channels the agent can prepare or execute

## Output Of Phase 0

Phase 0 is complete when:

1. The app identifier is locked.
2. Public-alpha repo posture is explicit.
3. The public scrub checklist has been run.
4. Release/distribution assumptions are stable enough for implementation.
5. Phase 1 can start without revisiting product-definition questions.
