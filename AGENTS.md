# AGENTS.md — Clawchestra

Instructions for agents interacting with Clawchestra (formerly Pipeline Dashboard).

**This document is the source of truth** for what operations are possible. If something can be done in the UI, it should be documented here so agents can replicate it.

> **📐 Design Principles:** Before building or modifying any feature, read [`docs/DESIGN_PRINCIPLES.md`](docs/DESIGN_PRINCIPLES.md). It defines the dual-surface principle (UI + AI for every feature), discoverability requirements, the stakes/reversibility matrix for agent actions, and the agent-native ethos. All feature work must conform to these principles.

---

<!-- COMPLIANCE:START — Auto-extracted to tool-specific files. Edit here, run scripts/sync-agent-compliance.sh -->

## Agent Compliance Block

> **This section is mechanically synced to all tool-specific config files (CLAUDE.md, .cursorrules, etc.).**
> Edit constraints HERE in AGENTS.md, then run `scripts/sync-agent-compliance.sh` to propagate.
> Never edit the compliance block directly in CLAUDE.md or other generated files — it will be overwritten.

### Schema Constraints (HARD — app rejects invalid values silently)

**Roadmap item statuses:** `pending` | `up-next` | `in-progress` | `complete` | `archived`
- No other values. Not `done`, not `finished`, not `shipped`, not `blocked`.

**Project statuses:** `in-progress` | `up-next` | `pending` | `dormant` | `archived`

**When setting `status: complete`:** Always also set `completedAt: YYYY-MM-DD` (ISO date).

### Hard Rules

1. **Completion requires human sign-off.** Never set `status: complete` on a roadmap item autonomously — including after `/build` workflows. After building, set `status: in-progress` with `nextAction: "Built — awaiting verification"`.

2. **Never touch the running app.** No `open`, `kill`, restart. No `tauri build` without `--no-bundle`. No installing to `/Applications/`. User controls app lifecycle via in-app Update button.

3. **Priorities are unique per column.** Check existing items before assigning. Default to bottom (max + 1).

4. **Keep `nextAction` in sync.** When you create/update a spec, plan, or code — update the roadmap item's `nextAction` field to reflect current state. Stale `nextAction` = broken UX.

5. **Document format: human-readable first.** No YAML frontmatter in spec/plan docs. Title → one-line blockquote → summary → metadata below the fold.

### File Structure

```
.clawchestra/state.json       — JSON (source of truth for roadmap, machine-readable)
CLAWCHESTRA.md                — Human documentation (do not edit programmatically)
roadmap/{item-id}.md          — Detail file per roadmap item
docs/specs/{item-id}-spec.md  — Spec documents
docs/plans/{item-id}-plan.md  — Plan documents
```

### Build & Test Commands

```bash
bun test                        # Run tests
npx tsc --noEmit                # Type check
pnpm build                      # Frontend only (fast)
npx tauri build --no-bundle     # Full release build (ALWAYS --no-bundle)
```

### Title Length Guideline
Aim for ~40 characters or fewer for roadmap item and project titles — this fits on one line at minimum card width. Two lines is acceptable. Avoid long titles that wrap to 3+ lines.

### Roadmap Item JSON Shape

```json
{
  "id": "kebab-case-id",
  "title": "Human-readable title",
  "status": "pending",
  "priority": 1,
  "specDoc": "docs/specs/id-spec.md",
  "planDoc": "docs/plans/id-plan.md",
  "nextAction": "What happens next",
  "tags": ["bug", "feature"]
}
```

<!-- COMPLIANCE:END -->

---

## Rule Zero: Check If This Doc Needs Updating

**Whenever making code changes to Clawchestra:**

1. **Always ask:** "Does this add, change, or remove any operation, capability, or rule?"
2. If YES → update this AGENTS.md before considering the work complete
3. If NO → no update needed, but the question must be asked

Not all code changes require doc updates. Bug fixes, styling tweaks, performance improvements may not affect agent-facing functionality. But we must **always check**.

**Questions to ask after any code change:**
- Does this change what operations are possible?
- Does this change how an operation works?
- Does this add new frontmatter fields or file structures?
- Does this change any rules (priorities, statuses, workflows)?

If any answer is YES → update AGENTS.md.

---

## Rule Two: Completion Requires Human Sign-Off

**Agents must NEVER mark a roadmap item as `complete` on their own. This includes `/build` workflows.**

The workflow is:
1. Agent ships the code, commits, builds
2. Item stays `in-progress` with `nextAction` like "Built — awaiting verification"
3. **Human** tests and explicitly says it's verified/complete
4. Only then does the agent set `status: complete` and `completedAt: YYYY-MM-DD`

Shipping code ≠ complete. The human decides when something is done.

**After a `/build` finishes:** Set `status: in-progress`, `nextAction: "Built — awaiting verification"`. Do NOT set `status: complete` or `status: done`.

When setting `status: complete` (after human sign-off), always set `completedAt` to the current ISO date (e.g. `2026-02-17`).

---

## Rule One: Never Touch the Running App

**Agents must NEVER:**
- Open, close, restart, or relaunch the app (`open`, `kill`, etc.)
- Install the app to `/Applications/` or anywhere else
- Run `tauri build` with DMG bundling (use `--no-bundle` always)
- Run `open` on built binaries or `.app` bundles
- Do anything that interrupts the user's running app session

**The correct workflow is:**
1. Make code changes and commit
2. Build with `npx tauri build --no-bundle` (or just `pnpm build` for frontend-only)
3. Tell the user the build is ready
4. **User** decides when to restart/update via the in-app Update button

The user may be mid-conversation in the chat drawer. Killing the app means lost context, interrupted work, and a bad experience. App lifecycle is always the user's choice.

**Only exception:** User explicitly asks you to restart or relaunch the app.

---

## Operations Reference

### Projects (Top-Level Board)

| Operation | How Agent Does It |
|-----------|-------------------|
| **View projects** | Read `CLAWCHESTRA.md` frontmatter from project directories under configured scan paths |
| **Add project** | Create project directory + `CLAWCHESTRA.md` with frontmatter + `.clawchestra/state.json` (see Adding Projects) |
| **Edit project metadata** | Edit frontmatter in `CLAWCHESTRA.md` |
| **Edit roadmap items** | Edit `.clawchestra/state.json` `roadmapItems` array |
| **Change status** | Update `status` field in `CLAWCHESTRA.md` frontmatter |
| **Change priority** | Update `priority` field (ensure uniqueness within column) |
| **Delete project** | Delete `CLAWCHESTRA.md` (removes from dashboard scan) |
| **Move to column** | Change `status` to target column value |

**Status values (ONLY these — app rejects others):** `in-progress` | `up-next` | `pending` | `dormant` | `archived`

### Roadmap Items

| Operation | How Agent Does It |
|-----------|-------------------|
| **View roadmap** | Read `.clawchestra/state.json` `roadmapItems` array |
| **Add item** | Add to `roadmapItems` array in `.clawchestra/state.json` |
| **Mark complete** | Set item `status: complete` + `completedAt: YYYY-MM-DD` (NOT `done`). Completion is a status change, not a file move |
| **Remove** | Remove from `roadmapItems` array (not a file deletion) |
| **Reprioritize** | Change `priority` values in `.clawchestra/state.json` |

**Roadmap status values (ONLY these — app rejects others):** `pending` | `up-next` | `in-progress` | `complete`

### Completed Items

| Operation | How Agent Does It |
|-----------|-------------------|
| **View completed items** | Filter `.clawchestra/state.json` `roadmapItems` for `status: complete` |
| **Complete an item** | Set `status: complete` + `completedAt: YYYY-MM-DD` in state.json |

### Dashboard Actions

| Operation | How Agent Does It |
|-----------|-------------------|
| **Trigger refresh** | Tell user to click Refresh (or file change triggers watcher) |
| **Open settings** | User clicks Settings in sidebar → board becomes Settings page; use Back to return |
| **Update paths** | Use Settings dialog or Tauri commands `get_dashboard_settings` + `update_dashboard_settings` |
| **Trigger update** | Commit code changes; user clicks Update button |
| **Run multi-branch Git Sync** | Use Sync dialog: select file categories, optional `Pull first` when behind, optional `Also sync to` branches, then commit on source and cherry-pick to targets. Push/pull controls are hidden for `(local)` branches without upstream. On conflicts, generate/edit an AI proposal in-dialog, explicitly approve apply, then continue sync; manual fallback prompts remain available. |
| **Local-only Kanban structure changes** | Project/roadmap status or priority moves made via board drag/drop auto-commit metadata (`CLAWCHESTRA.md` / `.clawchestra/state.json`) for local-only git repos (no remote). Deep/content edits still use Git Sync. |
| **Use lifecycle actions on roadmap cards** | Hover a roadmap kanban card, click one of five icons (Spec, Plan, Review, Deliver, Build); app opens chat drawer with an editable prefilled prompt (never auto-sends) |
| **Run onboarding reconciliation audit** | Use Tauri command `run_onboarding_reconciliation` to audit+repair tracked projects toward canonical onboarding invariants and return a per-project matrix (`before`, `actions`, `after`, `warnings`, invariant pass/fail) |
| **Adjust Kanban column visibility** | Use column header controls: up/down toggles card-list visibility; `chevrons-right-left` minimizes/restores the whole column. Both persist per board. |
| **Search/filter** | Not available via agent — UI only |

---

## Document Format (Specs, Plans, etc.)

Documents in `docs/specs/` and `docs/plans/` are read by both agents and humans. The UI surfaces them in modals when users click roadmap items. **Format for human readability first.**

### Required format:

```markdown
# Title

> One-line summary of what this does.

## Summary

2-3 sentence executive summary. What problem does it solve? What's the approach?

---

**Roadmap Item:** `item-id`
**Status:** Draft | Ready | Locked
**Created:** YYYY-MM-DD

---

## Details...
```

### Rules:
1. **NO YAML frontmatter** — no `---` delimited metadata blocks at the top
2. **Title and summary first** — the human-readable content goes above any metadata
3. **Metadata pushed below the summary** — status, dates, parent references go after the summary separator
4. **One-liner blockquote** under the title for at-a-glance understanding

### Why:
These documents appear in the UI when users click roadmap items. If the first thing they see is `title: "Chat Infrastructure Phase A: Reliability" / status: draft / type: spec`, it's a bad experience. Lead with what matters.

## Project Structure

```
.clawchestra/state.json — JSON: project + roadmapItems (source of truth)
CLAWCHESTRA.md          — Human documentation (frontmatter + markdown)
docs/                   — Spec and plan documents for roadmap items
src/                    — React frontend (TypeScript, Tailwind, shadcn/ui)
src-tauri/              — Rust backend (Tauri v2)
```

---

## Priority Rules (CRITICAL)

**Rule Zero:** Priorities must be unique within each status column.

When adding ANY item (project or deliverable) to the dashboard:

1. **Check existing priorities** in the target column first
2. **Assign bottom priority** by default (max existing + 1)
3. **If user specifies priority**, use it and bump others down as needed
4. **Never duplicate** — two items cannot share the same priority in the same column

Example: If Up Next has P1, P2, P3 and user says "add X to Up Next":
- Default: X gets P4
- If user says "add X at P2": X=P2, old P2→P3, old P3→P4

---

## Roadmap Workflow

Roadmap items live in `.clawchestra/state.json` as a JSON `roadmapItems` array.

When the user says **"add X to the roadmap"**:
1. Add to `roadmapItems` array in `.clawchestra/state.json`:
   ```json
   {
     "id": "item-id",
     "title": "X",
     "status": "pending",
     "priority": 1
   }
   ```
2. If it has a spec, create `docs/specs/{item-id}-spec.md`
3. If it has a plan, create `docs/plans/{item-id}-plan.md`

### Keep `nextAction` in sync (CRITICAL)

When you create or update an artifact for a roadmap item (spec, plan, etc.), **always update the item's `nextAction` field** in `.clawchestra/state.json` to reflect the new state. Examples:
- Wrote a spec → `nextAction: Spec written — ready for plan/build`
- Wrote a plan → `nextAction: Plan written — ready for build`
- Started building → `nextAction: Build in progress`

The `nextAction` is what humans see in the UI. If you write a spec but leave `nextAction` saying "Spec needed", the user sees stale/contradictory info.

**Also update the project-level `nextAction` in `CLAWCHESTRA.md`.** After any work session that changes roadmap state, update the `nextAction` field in `CLAWCHESTRA.md` frontmatter to reflect the current most-pressing action. Use the highest-priority `in-progress` item's next step as the source of truth. If nothing is `in-progress`, use the top `up-next` item. Format: `'item-title: what needs doing next'`.

When the user says **"mark X as done"** or **"X is complete"**:
1. Set `status: complete` and `completedAt: YYYY-MM-DD` on the item in `.clawchestra/state.json`
2. The item remains in `roadmapItems` with `status: complete` — it is NOT removed
3. Clawchestra displays completed items in the "Complete" column

When the user says **"remove X from the roadmap"** (without completing):
1. Remove the item from the `roadmapItems` array in `.clawchestra/state.json`
2. Do NOT add to CHANGELOG.md (it wasn't completed)

---

## Adding Projects

Projects are directories containing `CLAWCHESTRA.md` (human documentation) and `.clawchestra/state.json` (machine-readable state). They live under configured scan paths.

When the user says **"add project X"** or **"create project for X"**:

1. **Check existing priorities** in the target status column
2. **Create the project directory** (e.g., `{scanPath}/{project-id}/`)
3. **Create `CLAWCHESTRA.md`** with frontmatter:
   ```yaml
   title: X
   status: up-next  # or whatever column specified
   type: project
   priority: N      # unique within column, bottom by default
   lastActivity: YYYY-MM-DD
   ```
4. **Create `.clawchestra/state.json`** with project + roadmapItems:
   ```json
   {
     "project": { "title": "X", "status": "up-next", "description": "" },
     "roadmapItems": []
   }
   ```
5. **Add `.clawchestra/` to `.gitignore`** (state.json is device-local, not committed)
6. **Optional fields:** `tags`, `icon`, `repo`, `nextAction` in frontmatter; `specDoc`, `planDoc` on roadmap items

### Registering an Existing Project

If a git repo already exists and you want Clawchestra to track it:

1. Create `CLAWCHESTRA.md` in the repo root with frontmatter (title, status, type, priority)
2. Create `.clawchestra/` directory and `state.json` (project + empty roadmapItems), or let Add Existing import pre-existing state
3. Add `.clawchestra/` to `.gitignore`
4. Ensure the directory is under one of Clawchestra's configured scan paths
5. Run `scripts/inject-current-branch.sh` to add the Clawchestra Integration section to CLAUDE.md

**Wizard behavior (Add Existing):**
- If `.clawchestra/state.json` already exists, onboarding backs it up to `.clawchestra/backup/state.pre-onboarding.<timestamp>.json` and imports it (no destructive overwrite).
- If legacy `ROADMAP.md` is present, onboarding runs migration before canonical registration.
- For git repos, CLAUDE guidance injection is attempted automatically and remains non-fatal.

**Projects vs Sub-projects:**
- **Project** = top-level entity shown on main board (type: project)
- **Sub-project** = child entity with `parent:` field pointing to parent project ID (type: sub-project)

---

## Decision Escalation

When orchestrating sub-agents or coding agents:

### Always surface to user:
- Architecture/approach decisions (option A vs B)
- Plan review recommendations and suggested changes
- Scope changes ("should we also do X?")
- Error recovery options (retry, reduce scope, skip)
- Technology/library selection
- Breaking changes or data migrations
- Anything that changes what gets built

### Can proceed autonomously:
- File naming, formatting, code style
- Ordering of independent sub-tasks
- Mechanical execution within approved plan scope
- Git operations (commit, branch) within approved scope
- Test writing for already-approved features

### Format:
Always provide: project context, deliverable context, the decision, options with recommendations, and an explicit ask for direction.

---

## UI Patterns

This app uses:
- **shadcn/ui** — base component library
- **Tailwind CSS** — styling
- **Lucide React** — icons
- **Brand color**: `#DFFF00` (revival yellow) for accents, buttons, badges

**Sidebar controls:**
- Title bar includes **left + right** sidebar toggles (mirrored icons).
- Sidebar can dock **left or right**; only one side open at a time.
- Theme toggle lives **inside the sidebar**, aligned to the top-left (left dock) or top-right (right dock).
- **Settings mode:** clicking Settings switches the board to a full settings page; sidebar shows a “Back to Clawchestra” control (no tabs yet). Sidebar toggles cannot close the sidebar while in settings mode (can swap sides only).

When adding new UI:
- Check existing components in `src/components/ui/` first
- Match the existing dark/light theme patterns
- Keep components composable and typed

---

## Chat Integration

The app integrates with OpenClaw Gateway via Tauri commands:
- `openclaw_ping` — check gateway health
- `openclaw_chat` — send message and poll for response
- Messages support image attachments (base64 encoded)
- Attachment guardrails (chat UI): max 4 images, ~300KB combined encoded image budget per message (to stay under gateway WebSocket payload limits)
- On context-overflow / `413 failed to parse request`, the chat bridge auto-rotates to a fresh session key and retries once; avoid hardcoding the default session key in new chat logic.

Current chat UX is drawer-based:
- Collapsed bottom `ChatBar` for status + input
- Expanded unified drawer (history + composer in one panel)
- Top collapse control + drag handle in expanded mode
- Free-drag drawer height (clamped)
- Response completion toast (manual dismiss or open drawer)
- Composer supports app-level prefill requests (text inserted + focused, user still edits and sends manually)

### Slash Commands

Type `/` to see available commands. Commands are loaded dynamically from compound-engineering (`~/.config/opencode/`):

**Workflow Commands** (9 from `opencode.json`):
- `/plan` — Create implementation plans
- `/review` — Multi-agent code review
- `/work` — Execute plans with todo tracking
- `/deepen-plan` — Enhance plans with research
- `/brainstorm` — Explore requirements before planning
- `/compound` — Document solved problems
- `/test-browser` — Run browser tests
- `/resolve_todo_parallel` — Resolve CLI todos
- `/feature-video` — Record feature walkthrough

**Skill Commands** (18 from `skills/` directory):
- `/agent-browser` — Browser automation
- `/agent-native-architecture` — Build agent-first apps
- `/andrew-kane-gem-writer` — Ruby gems in Andrew Kane style
- `/brainstorming` — Explore requirements before planning
- `/compound-docs` — Capture solved problems as docs
- `/create-agent-skills` — Create Claude Code skills
- `/dhh-rails-style` — Ruby/Rails in DHH's style
- `/document-review` — Refine brainstorm/plan docs
- `/dspy-ruby` — Type-safe LLM apps with DSPy.rb
- `/every-style-editor` — Every's style guide compliance
- `/file-todos` — File-based todo tracking
- `/frontend-design` — Production-grade frontend UIs
- `/gemini-imagegen` — Generate images with Gemini
- `/git-worktree` — Manage Git worktrees
- `/orchestrating-swarms` — Multi-agent swarms
- `/rclone` — Cloud storage sync
- `/resolve_pr_parallel` — Resolve PR comments
- `/skill-creator` — Create effective skills

**Built-in Session Commands** (2):
- `/status` — Show session status
- `/new` — Start new session

**Total: 29 commands**

Commands are filtered via fuzzy matching as you type. Arrow keys navigate, Enter selects. Category badges show workflow (blue), skill (green), or session (purple).

### Message Queue

When the agent is working (processing a message), you can continue typing and submit additional messages. These are **queued** and sent automatically when the current response completes.

- Queue indicator shows in the chat bar header ("N queued")
- Queued messages appear above the input with ✕ to remove; retry-exhausted items remain as failed rows with a manual retry action
- Queue processes in FIFO order
- Send button shows clock icon when queuing

Primary frontend chat implementation lives in `src/components/chat/`.

---

## Build & Update

- `pnpm build` — frontend only (fast, for TS/React changes)
- `npx tauri build --no-bundle` — full release build (frontend + Rust, no DMG)
- **Never use `tauri build` without `--no-bundle`** — DMG bundler can install to /Applications
- **Never `open` the built binary** — user updates via in-app Update button
- The app embeds its git commit at build time; Update button appears when HEAD differs
- After building, tell the user "build ready" and let them update on their own schedule

---

## Key Files

- `src/App.tsx` — main app, state management
- `src/components/Header.tsx` — header with update button
- `src/components/SettingsDialog.tsx` — path and runtime settings UI
- `src/components/chat/ChatShell.tsx` — chat drawer + bar orchestration
- `src/components/chat/ChatBar.tsx` — composer/header used in collapsed and expanded states
- `src-tauri/src/lib.rs` — all Tauri commands
- `src-tauri/build.rs` — embeds BUILD_COMMIT at compile time
- `src-tauri/src/state.rs` — db.json schema and AppState
- `src/lib/store.ts` — Zustand store (projects, roadmap items)
- `src/hooks/useProjectModal.ts` — project modal state + roadmap reads/writes

---

## Cross-Branch Documents

Spec and plan documents (`docs/specs/`, `docs/plans/`) are git-tracked and may live on feature branches. Clawchestra uses `git show` to read documents cross-branch when they don't exist on the current branch.

When writing a `specDoc` or `planDoc` field on a roadmap item, make sure you're on the branch where the document lives. Clawchestra records the branch automatically via `specDocBranch`/`planDocBranch` fields and uses this as a hint for future cross-branch reads.

---

## Agent Guidance Injection

Clawchestra can inject a "Clawchestra Integration" section into `CLAUDE.md` across all local branches. This ensures agents on any branch know how to interact with `.clawchestra/state.json`.

**For agents that cannot call Tauri commands:**

Run `scripts/inject-current-branch.sh [project-dir]` to inject on the current branch only.

**Self-injection template** (if the script is not available, add this to CLAUDE.md manually):

```markdown
## Clawchestra Integration

Project orchestration state lives in `.clawchestra/state.json` (gitignored, always on disk).

**Read:** Open `.clawchestra/state.json` to see project status, roadmap items, priorities. Always read immediately before writing — do not cache contents across operations.
**Write:** Edit `.clawchestra/state.json` to update status, add items, change priorities. Include BOTH `project` and `roadmapItems` in every write. Clawchestra validates and syncs automatically.

**Schema rules:**
- Project statuses: in-progress | up-next | pending | dormant | archived
- Roadmap item statuses: pending | up-next | in-progress | complete
- When setting status: complete, always set completedAt: YYYY-MM-DD
- Priorities are unique per column
- Do NOT delete items from state.json — removal requires explicit action via Clawchestra UI
- Items you omit from `roadmapItems` are NOT deleted — Clawchestra restores them on next projection

**After writing:** If your changes don't appear in state.json after writing, check `.clawchestra/last-rejection.json` for validation errors.

**Do NOT edit:** CLAWCHESTRA.md (human documentation only), any files in `.clawchestra/` other than state.json.
```
