# Pre-Release Hardening

Deferred fixes from architecture-direction-v2 code reviews. See full spec: `docs/specs/pre-release-hardening-spec.md`

## Items

- CSP policy (#008) — before sharing with users
- Stale lock cleanup (#012) — before unattended operation
- Naming consistency (#011) — before onboarding contributors
- Integration tests (#023) — before next major refactor
- Migration timestamps (#009) — probably never

## When to Ship

The trigger event for most items is **before first public release or sharing the app with other users**. CSP (#008) is the only hard blocker; the rest are conditional on specific milestones (multi-user, contributors, etc).
