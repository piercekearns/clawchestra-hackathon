# Public Repo Document Inventory

> Classify current docs and root markdown files for public-alpha publication cleanup.

## Summary

This inventory separates documents that should read as public-facing product material from historical planning artifacts that may remain in the repo but should not be part of the primary public path. The goal is not to delete project history. It is to make the repo legible and non-personal when first published.

This is a Phase 0 publication artifact for `first-friend-readiness`.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Ready
**Created:** 2026-03-05
**Updated:** 2026-03-05

---

## Public-Facing Or Primary Repo Surface

These files should be clean, current, and safe to expose directly:

1. `README.md`
2. `AGENTS.md`
3. `CAPABILITIES.md`
4. `CLAWCHESTRA.md`
5. active FFR docs under `docs/specs/` and `docs/plans/`
6. current roadmap detail files under `roadmap/`

## Historical But Acceptable To Keep

These can remain in the repo if sanitized, but they should not be treated as the public onboarding path:

1. `SPEC.md`
2. `OVERVIEW.md`
3. `REVIEW-FIXES.md`
4. older architecture, migration, and refactor docs under `docs/specs/` and `docs/plans/`
5. historical solution notes under `docs/solutions/`

## Cleanup Rules Applied

For historical docs kept in the repo:

1. remove personal filesystem paths where practical
2. replace owner-specific machine assumptions with generic placeholders
3. avoid relying on them as the public install path
4. prefer keeping history over deleting context unless the file is actively harmful or misleading

## Remaining Repo-Cleanup Focus

Phase 0 cleanup should focus on:

1. root and public-facing markdown files
2. active specs/plans tied to current roadmap work
3. tests and examples that ship obvious owner-specific paths
4. product metadata and user-facing placeholders in current code
