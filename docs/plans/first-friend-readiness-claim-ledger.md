# First Friend Readiness Claim Ledger

> Track every naming, namespace, and package claim needed for first-friend public alpha.

## Summary

This ledger exists so FFR package and namespace work stays operationally legible. It records what should be claimed now, what should wait for a real package, what costs money, who owns it, and whether the agent can execute it directly or needs the user to act in a website/account UI.

Use this alongside the FFR plan during Phase 0 and early Phase 1 release setup.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Active
**Created:** 2026-03-05
**Updated:** 2026-03-06

---

## How To Use This Ledger

For each row:

1. decide whether the channel is `claim-now` or `defer`
2. verify availability
3. record who owns it
4. record whether it costs money now or later
5. record exactly how it was claimed or why it was deferred

## Claim Matrix

| Surface | Proposed Name / Identifier | Claim Timing | Likely Cost | Execution Mode | Owner Of Record | Current Status | Notes |
|---|---|---|---|---|---|---|---|
| App identifier | `ai.clawchestra.desktop` | claimed | none | repo/code change | project owner | claimed and implemented | Stable Tauri identity for storage and updater continuity |
| Domain | `clawchestra.ai` | claimed | paid, already owned | external account | project owner | claimed | Primary website domain |
| GitHub repo | `piercekearns/clawchestra` | claimed | none | external account | project owner | claimed | Public-alpha artifact source of truth |
| npm org / scope | `@clawchestra` | claimed | none for public packages per npm docs | web account + npm CLI | project owner | claimed | Primary JS package namespace; powers future npm/npx/pnpm/bun flows |
| npm fallback scope | `@clawchestra-ai` | fallback-only | none for public packages per npm docs | web account + npm CLI | project owner | not needed | Fallback if `@clawchestra` had been unavailable |
| npm unscoped package | `clawchestra` | claim only if a real bootstrap package ships in FFR; otherwise defer | none if published publicly, but publication creates maintenance surface | npm publish | project owner | decision tied to bootstrap implementation | Publish only if the package performs a real install/bootstrap job |
| JS runtime install methods | `npm` / `pnpm` / `npx` / `bun` / `pnpm dlx` / `bunx` | no separate claim needed | none beyond npm package ownership | documentation + package UX | project owner | clarified | A real npm package can power these flows; `pnpm`, `npx`, and `bunx` are execution methods, not separate registry claims |
| Homebrew tap repo | `piercekearns/homebrew-clawchestra` | claimed | none beyond GitHub | GitHub repo creation | project owner | claimed | Works immediately with `brew tap piercekearns/clawchestra` semantics if repo naming is aligned |
| WinGet package identifier | `Clawchestra.Clawchestra` | defer until Windows artifact exists | none expected for submission | GitHub PR / manifest submission | project owner | deferred | Should match real installer metadata and publisher strategy |
| Chocolatey package | `clawchestra` | defer until Windows artifact exists | no submission fee identified in docs reviewed | web account + package publish | project owner | deferred | Only worthwhile once the Windows install surface is real |
| Linux package names | `clawchestra` | defer until actual package channel is chosen | varies by channel | channel-specific | project owner | deferred | `.AppImage` and `.deb` do not require central package-name claiming in the same way |

## Management Notes

### Agent-managed work

The agent should:

1. prepare recommended names and fallbacks
2. verify availability where possible
3. make repo-side changes needed to support the chosen names
4. record outcomes and management notes in this ledger

### User-managed work

The user should perform claims that require ownership of a website account, payment method, or interactive account acceptance flow. After each such claim, the result should be written back into this ledger immediately.

## Recommended Early Claims

Claim these before Phase 1 if possible:

1. npm scope/org for `@clawchestra` or the best fallback
2. GitHub tap repo name `homebrew-clawchestra`

Do not spend time on separate `pnpm`, `bun`, or `npx` account claims because those are not separate registry surfaces for this use case.

### Deferred channels

Deferral is valid when:

1. the channel requires a real installer/package that does not exist yet
2. publishing now would create a fake placeholder package
3. the final publisher/install metadata is not stable yet
