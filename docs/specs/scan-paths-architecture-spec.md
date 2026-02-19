# Scan Paths Architecture

> Eliminate the sandbox projects folder — discover projects by scanning `~/repos/` and `~/projects/` for `PROJECT.md` files.

---

**Status:** Draft
**Created:** 2026-02-12

## Problem

Projects live in two places: repo-linked stubs in `clawdbot-sandbox/projects/` and actual code in `~/repos/`. This creates duplication risk, unclear source of truth, and requires manual stub maintenance. Ideas without repos have no proper home.

## Solution

The dashboard discovers projects by scanning configured folders for `PROJECT.md` files. No stubs. Every project — from embryonic idea to shipped product — follows the same minimal structure. The dashboard adapts its UI based on what documentation exists.

## Folder Layout

```
~/repos/                          → Proper git repos (remote on GitHub)
  ├── pipeline-dashboard/
  │   ├── PROJECT.md              → Required: identity + status
  │   ├── ROADMAP.md              → Optional: enables roadmap view
  │   └── docs/specs/             → Optional: enables doc badges
  ├── memestr/
  │   ├── PROJECT.md
  │   └── ROADMAP.md
  └── ClawOS/
      └── PROJECT.md

~/projects/                       → Pre-repo projects, ideas, research
  ├── nostr-dating/
  │   └── PROJECT.md
  ├── btc-folio/
  │   └── PROJECT.md
  └── decentralized-reputation/
      ├── PROJECT.md
      └── docs/research/
```

## Discovery

### Settings

```json
{
  "scanPaths": [
    "/Users/piercekearns/repos",
    "/Users/piercekearns/projects"
  ]
}
```

Replaces `catalog_root` and `openclawWorkspacePath` (for project scanning — OpenClaw workspace path remains separate for OpenClaw integration).

### Scanner Behaviour

1. Walk each `scanPath` **one level deep** (direct children only)
2. For each child directory, look for `PROJECT.md` in the root
3. If found, parse frontmatter → add to project list
4. If not found, skip (not every folder in `~/repos` needs to be a tracked project)
5. Project ID derived from folder name (e.g. `pipeline-dashboard`, `nostr-dating`)
6. Duplicate IDs across scan paths → error surfaced in dashboard

### No Flat Files

Every project is a **folder**, even if it's just one file inside:

```
~/projects/btc-folio/
  └── PROJECT.md       ✅ Discovered

~/projects/btc-folio.md   ❌ Not discovered (no flat files)
```

This keeps the door open for every project to grow (add ROADMAP.md, docs/, etc.) without restructuring.

## PROJECT.md Standard

### Required Fields (minimum viable project)

```yaml
---
title: "Nostr Dating"
status: idea | up-next | in-flight | archived
type: project
---
```

That's it. Three fields to appear on the board.

> **Note:** `shipped` is intentionally **not** a valid PROJECT.md status. When a project ships, it should be `archived` and its completion documented in a CHANGELOG. See [Shipped Items → CHANGELOG](#shipped-items--changelog) below.

### Optional Fields (unlock features)

```yaml
---
title: "Pipeline Dashboard"
status: in-progress
type: project

# Display
icon: "📊"
tags: [tooling, tauri, core]
priority: 1

# Tracking
nextAction: "Ship project modal improvements"
blockedBy: null
lastActivity: "2026-02-12"
lastReviewed: "2026-02-12"

# Relationships
parent: null
children: []

# Docs (override convention paths)
specDoc: docs/specs/some-spec.md
planDoc: docs/plans/some-plan.md

# GitHub (enables remote integration)
repo: piercekearns/pipeline-dashboard
---
```

### Content Below Frontmatter

The markdown body of `PROJECT.md` is the project description, rendered in the modal.

## Project Maturity Tiers

The dashboard infers a project's tier from what's present, and renders accordingly.

### Tier 1: Idea

**Has:** `PROJECT.md` only
**Located in:** `~/projects/`
**Dashboard shows:** Card on board, description in modal, no roadmap, no git status
**Visual indicator:** Ghost/outline style card, "💡 Idea" badge

### Tier 2: Local Project

**Has:** `PROJECT.md` + is a git repo (has `.git/`) but no `repo:` field
**Located in:** `~/repos/` or `~/projects/`
**Dashboard shows:** Card + local git status (branch, dirty/clean) + roadmap if exists
**Visual indicator:** Standard card, "📁 Local" badge

### Tier 3: Published Repo

**Has:** `PROJECT.md` + `repo:` field in frontmatter
**Located in:** `~/repos/`
**Dashboard shows:** Everything — git status, GitHub commit activity, remote sync status, roadmap, doc badges
**Visual indicator:** Standard card, "🔗 GitHub" badge or repo link

### Upgrade Path

Idea → Local Project:
1. `cd ~/projects/my-idea && git init`
2. (Optionally move to `~/repos/` — not required, scanner finds it either way)

Local Project → Published Repo:
1. `gh repo create` or push to GitHub
2. Add `repo: user/repo-name` to PROJECT.md frontmatter
3. Dashboard starts pulling GitHub data

No file moves required for upgrades. Just add capabilities.

## Progressive Feature Unlocking

| Feature | Requires |
|---------|----------|
| Appears on board | `PROJECT.md` with title + status |
| Description in modal | Markdown body in `PROJECT.md` |
| Roadmap items (L2 view) | `ROADMAP.md` in project root |
| Shipped items history | `CHANGELOG.md` in project root (auto-created with ROADMAP) |
| Doc badges on roadmap items | Files in `docs/specs/` or `docs/plans/` |
| Local git status | `.git/` directory present |
| Commit/Push buttons | `.git/` directory present |
| GitHub commit activity | `repo:` field in frontmatter |
| Staleness warnings | `repo:` field + `lastActivity` |

## Visual Differentiation on Board

Each card shows a small tier badge so you can instantly see what kind of project it is:

- **💡** — Idea (no git, no repo)
- **📁** — Local (has .git, no remote)
- **🔗** — GitHub (has repo field)

These replace the current "Repo-linked" / "Dashboard-only" badges which are less informative.

## ROADMAP.md Standard

Unchanged from current format:

```yaml
---
items:
  - id: feature-name
    title: Feature Name
    status: pending | in-progress | complete
    priority: 1
    nextAction: "What's next"
    tags: [ui, core]
---

# Notes

Optional markdown content below frontmatter.
```

> **Note:** `shipped` is not a valid roadmap item status. When an item reaches `complete`, it should be moved to `CHANGELOG.md` and removed from the ROADMAP. See below.

## CHANGELOG.md Standard

**CHANGELOG.md and ROADMAP.md are always created as a pair.** If a project has a ROADMAP.md, it must also have a CHANGELOG.md (and vice versa). The dashboard should enforce/scaffold this.

### Purpose

When a roadmap item is completed, it doesn't just disappear — it graduates to the CHANGELOG. This keeps the roadmap clean (only active/upcoming work) while preserving a record of everything shipped.

### Format

```yaml
---
entries:
  - id: chat-persistence
    title: Chat Persistence (SQLite)
    completedAt: "2026-02-12"
    summary: Full Rust/Tauri backend with WAL mode, cursor-based pagination, Zustand store integration.
    tags: [infra, chat]
  - id: chat-ux-overhaul
    title: Chat UX Overhaul
    completedAt: "2026-02-10"
    summary: Message queue, activity indicators, hybrid events + polling, status badge states.
    tags: [ui, chat]
---

# Changelog

Reverse-chronological record of shipped deliverables.
```

### Lifecycle

```
ROADMAP.md (pending → in-progress → complete)
    ↓ auto-migrate on complete
CHANGELOG.md (archived with completion date + summary)
```

When a roadmap item's status changes to `complete`:
1. The item is removed from `ROADMAP.md`
2. A corresponding entry is appended to `CHANGELOG.md` with `completedAt` timestamp and summary
3. The dashboard UI reflects this immediately — the item vanishes from the roadmap view

### Migration Policy: Auto-Migrate

When a roadmap item is marked `complete` (via status badge click or API), the dashboard **automatically** migrates it:
- Removes the item from `ROADMAP.md`  
- Adds it to `CHANGELOG.md` with the current date as `completedAt`
- The `summary` field defaults to the item's `nextAction` or title; user can edit later

This avoids manual bookkeeping. The user marks it done; the system handles archival.

### Dashboard Integration

| Feature | Behaviour |
|---------|-----------|
| Roadmap view | Only shows items from `ROADMAP.md` (active work) |
| Changelog tab | Shows completed items from `CHANGELOG.md` (read-only, reverse-chronological) |
| Mark complete | Auto-migrates item from ROADMAP → CHANGELOG |
| Scaffold | Creating `ROADMAP.md` also creates empty `CHANGELOG.md` (and vice versa) |
| Board cards | Project card never shows completed roadmap items — they're in the changelog |

## Migration Plan

### Phase 1: Create `~/projects/` and move ideas

- Create `~/projects/` directory
- For each idea/pre-repo project currently in `clawdbot-sandbox/projects/`:
  - Create `~/projects/{name}/` folder
  - Create `PROJECT.md` inside with frontmatter migrated from the sandbox `.md` file
  - Move any related content (research docs, notes) into the folder
- This includes: nostr-dating, botfather, decentralized-reputation, btc-folio, bitcoin-time-machine, bitchat-research, openclaw-browser-extension, openclaw-sdk, restricted-section projects, etc.

### Phase 2: Add `PROJECT.md` to existing repos

- For each repo already in `~/repos/` (pipeline-dashboard, memestr, ClawOS, piercekearns.com, Shopify-Fabric-Theme, clawd):
  - Create `PROJECT.md` in the repo root with standardised frontmatter
  - Ensure `ROADMAP.md` is in parseable frontmatter-items format (already done for pipeline-dashboard)
  - If `ROADMAP.md` exists, also create `CHANGELOG.md` (they're always paired)
  - Migrate any already-shipped items from ROADMAP into CHANGELOG
  - Content/description migrated from whatever sandbox stub currently exists

### Phase 3: Backend changes

- Add `scanPaths` to settings schema
- Replace `get_projects_dir()` with multi-path scanner
- Update `list_files()` to walk scan paths looking for `PROJECT.md`
- Detect `.git/` presence for tier inference
- Remove `catalog_root`, `catalog_entries_dir`, legacy mode logic
- Implement ROADMAP → CHANGELOG auto-migration on status `complete`
- Scaffold CHANGELOG.md when creating ROADMAP.md (and vice versa)

### Phase 4: Frontend changes

- Tier badges on cards (💡 📁 🔗)
- Settings UI for managing scan paths
- Remove any `catalog-only` / `trackingMode` references
- Changelog tab in project modal (reverse-chronological, read-only)
- Auto-migrate UX: marking an item `complete` triggers immediate archive + toast confirmation

### Phase 5: Cleanup

- **Delete all project files from `clawdbot-sandbox/projects/`** — these are now dead stubs
- Keep the `projects/` folder empty (or remove it) — OpenClaw workspace doesn't need it
- Remove migration/legacy code from Rust backend
- Update all documentation
- Verify no references to old sandbox project paths remain in settings, scripts, or AGENTS.md

## Decided Questions

- **Shipped status**: `shipped` is NOT a valid status for either PROJECT.md or ROADMAP.md items. Completed items graduate to CHANGELOG.md. This keeps the board and roadmap clean.
- **Auto-migration**: When a roadmap item is marked complete, it auto-migrates to CHANGELOG.md. No manual bookkeeping.
- **ROADMAP + CHANGELOG pairing**: These two files are always created together. If one exists, the other must too.

## Open Questions

1. **Nested projects**: Should scanner go 2 levels deep for monorepo-style projects? (e.g. `~/repos/nostr-ecosystem/memestr/PROJECT.md`) — Suggest: not in v1, add later if needed
2. **Auto-detection**: Should the dashboard auto-suggest adding `repo:` field when it detects a `.git/` with a remote? — Nice to have
3. **`~/projects/` naming**: Is `~/projects/` the right name, or could it conflict with other tools? Alternative: `~/sandbox/`, `~/lab/`, `~/incubator/`

## Non-Goals

- Moving repos between `~/projects/` and `~/repos/` automatically
- Creating GitHub repos from the dashboard
- Managing git operations beyond what already exists (commit planning docs, push)
