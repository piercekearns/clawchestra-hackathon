# Local Git Intelligence

Replace GitHub REST API calls with local git commands to eliminate 403 rate-limit errors and provide richer project data.

## Context

The app makes unauthenticated GitHub API calls (60/hr limit) on every project refresh. With 4+ repos this causes persistent 403 errors. All the data we're fetching is available locally via git commands, which the Rust backend already runs.

## Scope

- Extend Rust backend with enriched git status (last commit info, weekly count, branches, tags, stash)
- Add `git fetch` command for syncing remote state (uses git protocol, not REST API)
- Remove GitHub API calls from project load path
- Update frontend to consume enriched local data
- Keep GitHub module for future authenticated API features

## Key Decisions

- **In-memory only** — no database or file storage for git data, recalculated each refresh
- **`git fetch` is network-intentional** — only on startup, manual refresh, Git Sync dialog, and configurable background interval (default 5 min)
- **Local queries are effectively free** — run on every `loadProjects()` call, sub-millisecond
- **No AI needed** — pure Rust backend, works without OpenClaw

## Spec

See `docs/specs/github-api-403-errors-spec.md` for full schema, architecture, and migration plan.
