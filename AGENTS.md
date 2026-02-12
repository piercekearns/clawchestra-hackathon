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

**Status values:** `in-flight`, `up-next`, `simmering`, `dormant`, `shipped`

### Deliverables (Project Roadmaps)

| Operation | How Agent Does It |
|-----------|-------------------|
| **View roadmap** | Read files from `projects/pipeline-dashboard/roadmap/` |
| **Add deliverable** | Create `roadmap/{id}.md` with `type: deliverable` and `parent:` |
| **Mark done** | Set `status: shipped`, add to CHANGELOG.md |
| **Remove** | Delete file, update ROADMAP.md index |
| **Reprioritize** | Update `priority:` fields (keep unique) |

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
ROADMAP.md     — Index linking to individual roadmap item files
CHANGELOG.md   — Completed items with dates (historical record)
roadmap/       — Individual deliverable files (type: deliverable)
docs/          — Spec and plan documents for deliverables
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

Roadmap items are individual `.md` files in `roadmap/` with frontmatter.

When the user says **"add X to the roadmap"**:
1. Create `roadmap/{item-id}.md` with frontmatter:
   ```yaml
   title: X
   status: up-next
   type: deliverable
   priority: N
   parent: pipeline-dashboard
   lastActivity: YYYY-MM-DD
   ```
2. If it has a spec, create `docs/{item-id}/SPEC.md` and link via `specDoc`
3. Update `ROADMAP.md` index table

When the user says **"mark X as done"** or **"X is complete"**:
1. Change `status: shipped` in the deliverable file
2. Add an abbreviated entry to CHANGELOG.md under today's date:
   - Item name with ✅
   - 2-3 bullet points summarizing what was built
   - Optionally note key files changed if helpful for future reference
3. Update ROADMAP.md index

When the user says **"remove X from the roadmap"** (without completing):
1. Delete the file from `roadmap/`
2. Update ROADMAP.md index
3. Do NOT add to CHANGELOG.md (it wasn't completed)

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

- `pnpm tauri:dev` — development mode
- `./update.sh` — build and install to /Applications
- The app embeds its git commit at build time; Update button appears when HEAD differs

---

## Key Files

- `src/App.tsx` — main app, state management
- `src/components/Header.tsx` — header with update button
- `src/components/SettingsDialog.tsx` — path and runtime settings UI
- `src/components/chat/ChatShell.tsx` — chat drawer + bar orchestration
- `src/components/chat/ChatBar.tsx` — composer/header used in collapsed and expanded states
- `src-tauri/src/lib.rs` — all Tauri commands
- `src-tauri/build.rs` — embeds BUILD_COMMIT at compile time
