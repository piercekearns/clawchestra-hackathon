# AGENTS.md — Pipeline Dashboard

Instructions for agents interacting with the Pipeline Dashboard.

**This document is the source of truth** for what operations are possible. If something can be done in the UI, it should be documented here so agents can replicate it.

---

## Rule Zero: Check If This Doc Needs Updating

**Whenever making code changes to the Pipeline Dashboard:**

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
| **View projects** | Read files from configured catalog root (`get_dashboard_settings` → `catalogRoot`) |
| **Add project** | Create `{catalogRoot}/{id}.md` with proper frontmatter (see Adding Projects) |
| **Edit project** | Edit frontmatter in the project's `.md` file |
| **Change status** | Update `status:` field in frontmatter |
| **Change priority** | Update `priority:` field (ensure uniqueness!) |
| **Delete project** | Delete the `.md` file |
| **Move to column** | Change `status:` to target column value |

**Status values:** `in-flight`, `up-next`, `simmering`, `dormant`, `shipped`, `archived`

### Roadmap Items

| Operation | How Agent Does It |
|-----------|-------------------|
| **View roadmap** | Parse `ROADMAP.md` frontmatter `items:` array |
| **Add item** | Append to `items:` array in ROADMAP.md frontmatter |
| **Mark done** | Set item `status: complete` — auto-migrates to CHANGELOG.md |
| **Remove** | Delete from `items:` array (not a file deletion) |
| **Reprioritize** | Change `priority:` values in ROADMAP.md frontmatter |

### CHANGELOG

| Operation | How Agent Does It |
|-----------|-------------------|
| **View changelog** | Parse `CHANGELOG.md` frontmatter `entries:` array |
| **Edit entries** | Read-only for agents unless explicitly asked to edit |

### Dashboard Actions

| Operation | How Agent Does It |
|-----------|-------------------|
| **Trigger refresh** | Tell user to click Refresh (or file change triggers watcher) |
| **Open settings** | User clicks Settings button in header |
| **Update paths** | Use Settings dialog or Tauri commands `get_dashboard_settings` + `update_dashboard_settings` |
| **Trigger update** | Commit code changes; user clicks Update button |
| **Search/filter** | Not available via agent — UI only |

---

## Project Structure

```
ROADMAP.md     — Frontmatter items: array of roadmap items
CHANGELOG.md   — Frontmatter entries: array of completed items
docs/          — Spec and plan documents for roadmap items
src/           — React frontend (TypeScript, Tailwind, shadcn/ui)
src-tauri/     — Rust backend (Tauri v2)
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

Roadmap items live in `ROADMAP.md` as a YAML frontmatter `items:` array.

When the user says **"add X to the roadmap"**:
1. Add to `items:` array in ROADMAP.md frontmatter:
   ```yaml
   - id: item-id
     title: X
     status: pending
     priority: N
   ```
2. If it has a spec, create `docs/specs/{item-id}-spec.md`
3. If it has a plan, create `docs/plans/{item-id}-plan.md`

When the user says **"mark X as done"** or **"X is complete"**:
1. Change item `status: complete` in ROADMAP.md — this triggers auto-migration:
   - Item is appended to CHANGELOG.md `entries:` array (with `completedAt` date)
   - Item is removed from ROADMAP.md `items:` array
   - Migration is idempotent

When the user says **"remove X from the roadmap"** (without completing):
1. Remove the item from the `items:` array in ROADMAP.md
2. Do NOT add to CHANGELOG.md (it wasn't completed)

---

## Adding Projects

Projects are markdown files in the configured catalog root (`catalogRoot` in settings).

When the user says **"add project X"** or **"create project for X"**:

1. **Check existing priorities** in the target status column
2. **Create** `{catalogRoot}/{project-id}.md` (or appropriate subdirectory)
3. **Frontmatter** must include:
   ```yaml
   title: X
   status: up-next  # or whatever column specified
   priority: N      # unique within column, bottom by default
   type: project
   lastActivity: YYYY-MM-DD
   ```
4. **Optional fields:** `tags`, `icon`, `repo`, `localPath`, `nextAction`

**Projects vs Deliverables:**
- **Project** = top-level entity shown on main board (type: project)
- **Deliverable** = child item within a project's roadmap (type: deliverable, has `parent:`)

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

Current chat UX is drawer-based:
- Collapsed bottom `ChatBar` for status + input
- Expanded unified drawer (history + composer in one panel)
- Top collapse control + drag handle in expanded mode
- Free-drag drawer height (clamped)
- Response completion toast (manual dismiss or open drawer)

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
- Queued messages appear above the input with ✕ to remove
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
