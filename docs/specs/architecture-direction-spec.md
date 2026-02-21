# Architecture Direction: OpenClaw Integration, Data Sync, and Multi-Platform

> Captures the full architectural direction for Clawchestra's evolution from single-device desktop app to a multi-platform client backed by OpenClaw as sync layer.

## Summary

Clawchestra is evolving from a standalone desktop app with git-tracked project state into a **client** that treats OpenClaw as its backend for data sync, AI chat, and multi-device coordination. This document captures every decision, trade-off, open question, and implementation detail discussed during the 2026-02-21 architecture sessions.

---

**Created:** 2026-02-21
**Status:** Living document (decisions may evolve)
**Related:** `first-friend-readiness-spec.md`, `git-sync-spec.md`

---

## Table of Contents

1. [Core Thesis](#1-core-thesis)
2. [Where Orchestration Data Lives](#2-where-orchestration-data-lives)
3. [Agent Schema Enforcement](#3-agent-schema-enforcement)
4. [Knowledge Injection Across Branches](#4-knowledge-injection-across-branches)
5. [Sync Mechanism: Programmatic, Not Conversational](#5-sync-mechanism-programmatic-not-conversational)
6. [OpenClaw Data Endpoint Feasibility](#6-openclaw-data-endpoint-feasibility)
7. [OpenClaw Training and Client Identity](#7-openclaw-training-and-client-identity)
8. [Conflict Resolution and Concurrent Writers](#8-conflict-resolution-and-concurrent-writers)
9. [File Locking for Same-Machine Races](#9-file-locking-for-same-machine-races)
10. [Database Format for Sync](#10-database-format-for-sync)
11. [Chat History and Multi-Device Sessions](#11-chat-history-and-multi-device-sessions)
12. [Git Branch Injection During Onboarding](#12-git-branch-injection-during-onboarding)
13. [Multi-Platform Roadmap](#13-multi-platform-roadmap)
14. [GitHub Login Utility](#14-github-login-utility)
15. [Impact on First-Friend-Readiness](#15-impact-on-first-friend-readiness)
16. [Decision Table](#16-decision-table)
17. [Resolved Questions](#17-resolved-questions-formerly-open)
18. [Trigger Events: When to Upgrade Architecture](#18-trigger-events-when-to-upgrade-architecture)
19. [Second and Third-Order Effects](#19-second-and-third-order-effects)

---

## 1. Core Thesis

**Clawchestra is a client, not a platform.** The data schema is an open standard. OpenClaw is the backend. Multiple Clawchestra instances (desktop, mobile, web) connect to the same OpenClaw instance and share the same project data.

This means:
- Orchestration data (roadmap items, project status, kanban positions) lives in a database, not in git-tracked markdown files
- The database syncs to/from OpenClaw as a file on OpenClaw's filesystem
- Any Clawchestra client can read/write this data regardless of whether git is available
- AI coding agents interact with the data via a gitignored projection file (`.clawchestra/state.json`)
- The sync mechanism is programmatic (file I/O), not conversational (AI chat)

### Product Vision: What This Architecture Enables

This architecture change isn't just a technical refactor — it transforms what Clawchestra can become.

**The problem Clawchestra solves:** People who build things with AI — developers, vibe coders, productivity-focused users — track their work across dozens of fragmented tools. One project's plan is in Notion, another's in Apple Notes, a third lives in a repo's TODO.md. Each project has its own tracking method. None of them talk to each other. And none of them are connected to the AI that actually does the work.

**What Clawchestra becomes:** A unified place to see, plan, track, and deliver on everything you're working on — powered by your own AI agent.

- **See everything**: All your projects on one kanban board, regardless of where the code/files live
- **Plan with AI**: Break projects into deliverables. Your AI agent understands the schema, the priorities, the dependencies
- **Deliver with AI**: Don't just plan — execute. The AI that helps you plan is the same AI that writes the code, sends the email, deploys the change
- **Take it everywhere**: Because state syncs through OpenClaw, you manage and work on projects from any device. OpenClaw IS the cloud — but it's YOUR cloud, on YOUR infrastructure
- **Expandable beyond code**: The starting point is git repos and software projects, but with OpenClaw's capabilities (computer control, tool use, integrations), a roadmap item could be "send an email to John" or "post the weekly update" — not just "build the auth system"

**The architecture direction is what makes this possible.** Moving from "local files on one computer" to "synced state backed by your AI agent" is the unlock. Without it, Clawchestra is a nice kanban board. With it, Clawchestra is a project orchestration platform where the AI doesn't just help you plan — it does the work, from anywhere.

**In one sentence:** Clawchestra is an AI-native project management app where your AI agent plans the work, does the work, and keeps everything in sync across all your devices — using an open schema that makes project state a first-class concept your AI understands natively.

### Why not just keep PROJECT.md in git?

PROJECT.md stored per-repo per-branch creates three problems:
1. **Branch fragmentation**: Moving a kanban item on one branch doesn't move it on others. Switching branches visually rearranges the board.
2. **Schema drift**: Different branches can have different (or invalid) status values. `in-flight` on one branch, `in-progress` on another.
3. **No single source of truth**: With N branches and M projects, there are N*M copies of state, most slightly different.

The database approach gives one canonical state that all branches and all devices see.

---

## 2. Where Orchestration Data Lives

### Current state
- `PROJECT.md` in each repo root (git-tracked, per-branch)
- `ROADMAP.md` in each repo root (git-tracked, per-branch)
- Clawchestra DB (local SQLite via Tauri) aggregates and caches this data

### Target state
- **Clawchestra DB** is the source of truth for orchestration data
- `.clawchestra/state.json` (gitignored) is a projection written by Clawchestra for agent consumption
- `CLAWCHESTRA.md` (tracked) is human-readable documentation of the schema (not runtime-critical)
- DB syncs to OpenClaw's filesystem for multi-device access

### Rename: PROJECT.md -> CLAWCHESTRA.md

**Status:** Confirmed
**Rationale:** Makes the coupling between the file and the tool explicit. The file becomes schema documentation, not the source of truth. Agents read `.clawchestra/state.json` instead.

---

## 3. Agent Schema Enforcement

### The problem
AI coding agents (Claude Code, Codex, Cursor) need to read and write project orchestration state. They need to know: what roadmap items exist, what status they're in, how to update them.

### The solution: layered injection

```
CLAUDE.md / .cursorrules / agents.md (agents already read these)
  -> "Project state lives in .clawchestra/state.json"
  -> "Schema: [embedded or referenced]"
  -> Agent reads state.json, makes changes, writes back
  -> Clawchestra watches state.json, validates, syncs to DB
```

### Schema enforcement details

**Read path**: Agents get a well-typed JSON blob. The structure IS the schema — field names, value types, and valid enum values are self-documenting.

**Write path**: When an agent writes to `state.json`, Clawchestra validates on ingest:
- Status must be one of: `in-progress | up-next | pending | dormant | archived` (projects) or `pending | up-next | in-progress | complete` (roadmap items)
- Priority must be a number, unique within column
- If `status: complete`, must also have `completedAt: YYYY-MM-DD`
- Invalid writes are rejected (file reverted to last-known-good state, or invalid fields ignored)

**Schema embedding**: The `state.json` file itself can contain a `$schema` field or inline documentation, making it self-describing even without `CLAWCHESTRA.md`.

### Key insight: gitignored files are visible to agents

Gitignored files exist on disk. Agents read files from disk, not from git's index. `.clawchestra/state.json` being gitignored makes it invisible to `git status` and `git add`, but fully readable by any agent or application. This is the fundamental enabler — the state file is branch-independent because git doesn't track it, but agents can always find it.

---

## 4. Knowledge Injection Across Branches

### The risk: stale roadmap data

If an agent works on a branch that doesn't have the CLAUDE.md pointer to `.clawchestra/state.json`, it might:
- Complete a feature without updating roadmap status
- Add code that should be a roadmap item without creating one
- Result in disconnect between code reality and roadmap state

**This is more consequential than "missed opportunity" — it's stale data in the orchestration layer, which is exactly what Clawchestra exists to prevent.**

### Mitigation strategy

1. **New branches inherit automatically**: Branches created after CLAUDE.md injection fork from a branch that already has the pointer. This is the common case.

2. **Clawchestra injects during project setup**: When a user adds a GitHub-connected project, Clawchestra:
   - Scans all local + remote branches via git CLI
   - Checks out each branch, adds/updates CLAUDE.md section, commits, checks out next
   - Reports results: "Injected into 12/12 branches" or "10/12 — failed on X, Y (details)"
   - This is NOT cherry-pick — it's direct file addition per branch (simpler, no merge conflicts for a new file)

3. **Old pre-existing branches are a known gap**: Branches that existed before Clawchestra was set up and haven't been rebased/merged since. The gap shrinks over time as branches are merged.

4. **Fallback**: If an agent doesn't know about `.clawchestra/state.json`, it simply doesn't update the kanban. The data isn't corrupted — it's stale. A human or a subsequent agent run can fix this.

### What the injection loop looks like (git CLI)

```bash
original_branch=$(git branch --show-current)
for branch in $(git branch --format='%(refname:short)'); do
  git checkout "$branch"
  # Add or update CLAUDE.md section
  # Add or create .cursorrules section (if Cursor detected)
  git add CLAUDE.md .cursorrules 2>/dev/null
  git commit -m "chore: add Clawchestra agent guidance" --allow-empty 2>/dev/null || true
done
git checkout "$original_branch"
```

### Timing and performance

- 15 branches: ~30-60 seconds (checkout + write + commit per branch)
- Unlikely to fail: adding a new section to CLAUDE.md rarely conflicts with existing content
- If CLAUDE.md doesn't exist on a branch: creates it fresh (even simpler)
- If CLAUDE.md exists and has conflicting content: append the section (git handles this as a normal change, not a merge)

### Failure cases (narrow)

| Failure | Likelihood | Consequence | Resolution |
|---------|-----------|-------------|------------|
| Branch has uncommitted changes | Low (Clawchestra checks first) | Checkout fails for that branch | Stash, inject, pop; or skip and report |
| Branch is protected (GitHub) | N/A (these are local operations) | N/A | Local branches can't be protected |
| Branch in detached HEAD state | Very low | Checkout succeeds by name | Handled automatically |
| Branch mid-rebase | Very low | Checkout fails | Skip and report |
| CLAUDE.md has merge conflicts | Very low (adding, not modifying) | Commit fails | Skip and report |

### Does this need AI to resolve failures?

**No.** The failure cases are git-mechanical, not semantic. If a branch can't be checked out, skip it. If CLAUDE.md can't be committed, skip it. Report the failures to the user with clear explanations. No AI inference needed.

**However:** OpenClaw being available during setup is nice-to-have (for the chat experience), not required for branch injection. Git CLI is sufficient.

---

## 5. Sync Mechanism: Programmatic, Not Conversational

### The principle

**Data transfer = code. Intent interpretation = AI.**

Syncing the database to/from OpenClaw should NEVER go through the AI chat interface. The reasons:
- **Token cost**: Every sync burns inference tokens for a trivial file read/write
- **Latency**: AI inference (seconds) vs file I/O (milliseconds)
- **Fragility**: AI might misparse the request, return partial data, hallucinate
- **Cost at scale**: Syncing every 30 seconds via chat would be absurd

### What IS appropriate for AI

- "What should I work on next?" (AI reasons about priorities, context, dependencies)
- "Create two roadmap items for X and Y" (AI understands intent, generates structured data)
- "Mark authentication as complete" (AI maps natural language to specific state change)
- "Delete that roadmap item I added earlier" (AI resolves reference, performs action)

### What is NOT appropriate for AI

- Initial database sync on launch (programmatic)
- Periodic state sync between devices (programmatic)
- Pushing updated state.json after kanban drag (programmatic)
- Pulling latest state after reconnect (programmatic)

### The AI-to-programmatic handoff

When AI makes a change (e.g., creates a roadmap item), the AI writes to the Clawchestra DB (via a tool or API). The actual sync of that DB change to OpenClaw's filesystem happens programmatically — the AI doesn't need to "commit" or "push" the database. Clawchestra handles sync automatically.

---

## 6. OpenClaw Data Endpoint Feasibility

### Investigation result: HIGHLY FEASIBLE

OpenClaw (v2026.2.17) has a mature plugin SDK with `registerHttpRoute()` as a first-class API. Adding a `/data/` endpoint requires:

- **No modification to OpenClaw core** — it's a simple extension file
- **~100 lines of TypeScript** in `~/.openclaw/extensions/data-endpoint.ts`
- **Built-in auth** — routes inherit gateway token authentication
- **Express.js integration** — standard Node.js request/response handling

### Implementation approach

```typescript
// ~/.openclaw/extensions/data-endpoint.ts
export default function (api) {
  api.registerHttpRoute({
    path: "/data/*",
    handler: async (req, res) => {
      // Validate path (prevent directory traversal)
      // GET: read file, return content
      // PUT: parse body, write file
      // POST: merge/update semantics if needed
    }
  });
}
```

### How Clawchestra uses it

**Local (same machine):** Direct filesystem access to `~/.openclaw/clawchestra/db.json`. Zero overhead. This is what Pierce uses now and what a friend with local OpenClaw would use.

**Remote (VPS or different machine):**
```
GET  http://openclaw-host:18789/data/clawchestra/db.json   -> returns DB
PUT  http://openclaw-host:18789/data/clawchestra/db.json   -> writes DB
```
Auth via the same bearer token used for chat. No extra setup beyond installing the extension.

### How the extension gets installed

**Local OpenClaw (same machine):** Clawchestra writes `~/.openclaw/extensions/data-endpoint.ts` directly during onboarding. The user doesn't do anything — Clawchestra has filesystem access to the same machine. No SSH, no commands, no file creation.

**Remote OpenClaw (VPS or other machine):** Three approaches, in order of preference:

1. **OpenClaw self-setup (best UX):** Once Clawchestra connects to the remote OpenClaw via WebSocket, it asks OpenClaw (via the AI chat) to create the extension file on its own filesystem. OpenClaw has filesystem access on its own machine — it can write `~/.openclaw/extensions/data-endpoint.ts` itself. The user sees: "Setting up data sync... done." No SSH, no manual file creation, no terminal commands.

2. **One-command install (fallback):** If OpenClaw can't self-setup (e.g., sandboxed environment), the onboarding wizard shows a single copy-paste command: "Run this on the machine where OpenClaw is running:" → `openclaw install-extension clawchestra-data` (or equivalent). Not "SSH in and create a file" — one command, shown in the wizard, not buried in a README.

3. **No extension needed (SSH tunnel):** If the user has an SSH tunnel making the remote OpenClaw appear local (port forwarding), Clawchestra accesses the filesystem directly as if it were local. No extension needed. The onboarding wizard explains this option in plain language: "If you've already set up port forwarding to your OpenClaw server, select 'Local' — Clawchestra will handle the rest."

**Design principle: all setup instructions live in the onboarding wizard, never in a README.** The wizard should guide any user — not just developers — through whatever setup is needed for their configuration. If they already have OpenClaw running, great, give us the details. If they don't, help them set it up.

### Access rights and permissions transparency

When Clawchestra connects to OpenClaw, the onboarding wizard must explicitly communicate what access is being granted:

**Clawchestra WILL:**
- Chat with your AI agent (send/receive messages)
- Store project orchestration data on OpenClaw's filesystem (`~/.openclaw/clawchestra/`)
- Sync project state between your devices via OpenClaw
- Install a data sync extension (with your confirmation)

**Clawchestra will NOT:**
- Access files outside the `~/.openclaw/clawchestra/` directory
- Send data to any external service (all data stays between your device and your OpenClaw)
- Modify OpenClaw's core configuration
- Act without your confirmation during setup

This transparency is important because the app will be source-viewable — users can verify these claims.

### Security considerations

- Path validation: only serve files under `~/.openclaw/clawchestra/` (no directory traversal)
- Auth: inherited from gateway token (already configured)
- CORS: needed if browser clients will access directly (add headers in handler)
- Rate limiting: optional, probably unnecessary for single-user

---

## 7. OpenClaw Training and Client Identity

### System prompt injection

When Clawchestra integrates with OpenClaw, it injects context into OpenClaw's system prompt (or session context). This teaches OpenClaw:

- What Clawchestra is and why it's connected
- Where the database lives (`~/.openclaw/clawchestra/db.json`)
- The database schema (valid statuses, field types)
- What Clawchestra clients exist and their identities
- How to respond to Clawchestra-related requests

### Client identity

Each Clawchestra instance generates a UUID at first launch. This UUID is:
- Stored locally in Clawchestra's settings
- Sent with every request to OpenClaw (in headers or request body)
- Registered in OpenClaw's context: "Client `abc-123` is Pierce's MacBook desktop, client `def-456` is Pierce's iPhone"

### Same session across devices

When multiple Clawchestra instances connect to the same OpenClaw:
- They should share the same chat session (not create separate conversations)
- OpenClaw identifies which client is talking via the client UUID
- Chat history is continuous — "I moved the auth item to in-progress" from desktop is visible when checking from mobile
- OpenClaw's session system already supports this: connect to the same session key (`agent:main:clawchestra`)

### Training content (injected programmatically, not via chat)

```
You are integrated with Clawchestra, a project orchestration tool.

Database location: ~/.openclaw/clawchestra/db.json
Database format: JSON (see schema below)

Known clients:
- abc-123: Pierce's MacBook (desktop, macOS)
- [more as they register]

When a Clawchestra client asks about project state, roadmap items, or kanban
positions, reference the database. When making changes to project state,
write to the database. Sync happens automatically — do not ask the user
to manually sync.

Schema:
- Project statuses: in-progress | up-next | pending | dormant | archived
- Roadmap item statuses: pending | up-next | in-progress | complete
- When setting status: complete, always set completedAt: YYYY-MM-DD
- Priorities are unique per column (check existing before assigning)
```

---

## 8. Conflict Resolution and Concurrent Writers

### Who writes to the data?

1. **Clawchestra UI** (user drags kanban items, edits fields)
2. **AI agents** (Claude Code, Codex update roadmap items via `.clawchestra/state.json`)
3. **OpenClaw AI** (creates roadmap items, updates status via chat)
4. **Potentially: autonomous bots** (complete tasks, update status)

### Conflict scenarios and resolution strategy

| Scenario | Conflict Window | Strategy | When to Upgrade |
|----------|----------------|----------|-----------------|
| **Single device, single user** | No conflict possible | N/A | N/A |
| **Single device, user + agent** | Seconds (both write state.json) | File-level locking | NOW (already relevant) |
| **Two desktops, same user** | Minutes-hours (between syncs) | Last-write-wins with per-field timestamps | When second desktop is real |
| **Desktop + mobile, same user** | Hours (phone often offline) | Per-field timestamps | When mobile app exists |
| **Multiple users, same kanban** | Continuous | Operation-based sync or explicit conflict UI | When multi-user is real |
| **Autonomous bots, frequent updates** | Seconds-minutes | File locking (same machine) or operation log (remote) | Already partially relevant |

### Autonomous bots: is this already a problem?

**Partially yes.** Claude Code already updates roadmap items (per AGENTS.md guidance). Today it writes to `ROADMAP.md` (a git file) while Clawchestra reads from its DB — separate systems, no race. In the new model where both write to `state.json`, there IS a race condition on day one.

**However:** The race window is narrow (both need to write within milliseconds), and the consequence is minor (one write gets overwritten — user sees stale status, drags it to correct position). File locking mitigates this entirely for the same-machine case.

### Real-world examples of the bot conflict

**Example 1: User drags + agent updates simultaneously**
- User drags "auth" from up-next to in-progress (Clawchestra writes state.json)
- Claude Code finishes building auth, updates status to in-progress with nextAction (writes state.json)
- Both happen within seconds
- Without locking: one write overwrites the other. User's drag might be lost (annoying) or agent's nextAction update might be lost (stale data)
- With file locking: writes are serialized. Both apply. Correct result.

**Example 2: Agent runs while user is away**
- User starts a Claude Code build and walks away
- Agent completes, updates 3 roadmap items
- User returns, opens Clawchestra
- No conflict — agent wrote, Clawchestra reads. Clean.

**Example 3: Remote agent + local user**
- OpenClaw (on VPS) updates a roadmap item via AI chat
- User (on laptop) drags a kanban item
- OpenClaw writes to its copy of db.json; user writes to local state.json
- On next sync, last-write-wins applies
- This is the multi-device scenario — per-field timestamps would be better here

---

## 9. File Locking for Same-Machine Races

### UX implications

**The lock is invisible to the user.** It's a filesystem advisory lock held for milliseconds during a write operation. The user never sees "file locked" or gets blocked from dragging.

Detailed flow:
1. User drags item from column A to column B
2. Clawchestra acquires lock on `state.json` (instant — lock is available)
3. Clawchestra writes the updated state
4. Clawchestra releases lock
5. Total time: <10ms. User sees the drag complete instantly.

If an agent is writing at the exact same moment:
1. Agent tries to acquire lock
2. Lock is held by Clawchestra — agent waits (microseconds to milliseconds)
3. Clawchestra releases lock
4. Agent acquires lock, reads current state (which now includes the user's drag), merges its change, writes, releases
5. Both changes apply. No data loss.

**The user never knows locking exists.** There's no UI for it. No "checked out by AI" state. No disabled buttons. It's purely a backend coordination mechanism.

### Implementation

- `flock()` on Unix (macOS/Linux) — advisory file lock
- `LockFile` on Windows — same concept
- Both are non-blocking with retry: try lock, if busy wait 1ms, retry, up to 100ms, then proceed without lock (fail-open)
- Agent guidance in CLAUDE.md: "When writing to `.clawchestra/state.json`, acquire a file lock first"

---

## 10. Database Format for Sync

### Decision: JSON

**Full database exported as JSON.** Not SQLite binary, not partial state, not operation log.

### Why JSON over SQLite

| Factor | JSON | SQLite |
|--------|------|--------|
| **Human-readable** | Yes — open in any editor | No — binary format |
| **Diffable** | Yes — see exactly what changed | No — binary diff meaningless |
| **Agent-compatible** | Yes — any AI can read/write JSON | No — requires SQLite library |
| **Dependencies** | Zero — every language parses JSON | SQLite library (ubiquitous but still a dep) |
| **File size** | Smaller (just data, no indexes/metadata) | Larger (includes schema, indexes, empty pages) |
| **Concurrent access** | Needs external locking | Built-in WAL locking |
| **Serialization cost** | Trivial at this scale (KB) | Zero (it IS the format) |
| **Corruption visibility** | Obvious (malformed JSON) | Silent (corrupt pages) |

### Expected database size

- 10 projects, 50 roadmap items: ~20KB JSON
- 50 projects, 500 roadmap items: ~200KB JSON
- 100 projects, 1000 roadmap items: ~500KB JSON

At these sizes, serialization overhead is imperceptible. JSON is correct indefinitely for orchestration data.

### When SQLite becomes relevant

If the database grows to include:
- **Chat histories** (potentially megabytes per session)
- **File attachments or media** (arbitrary size)
- **Detailed audit logs** (every state change recorded)

At that point, shipping the entire DB as JSON becomes expensive. SQLite's binary format is more efficient for large blobs.

**However:** Chat history syncing is a separate concern from kanban state syncing. The kanban DB (JSON) and chat history (SQLite) can use different sync mechanisms.

---

## 11. Chat History and Multi-Device Sessions

### Current architecture (dual storage)

Clawchestra has a **dual chat storage** system:

1. **Local SQLite** (`~/.local/share/clawchestra/chat.db`): Messages saved locally as they're sent/received. Used for instant display on app launch without waiting for OpenClaw.
2. **OpenClaw session storage** (`~/.openclaw/agents/main/sessions/`): The canonical remote store. OpenClaw manages session history on its machine.
3. **Recovery cursor**: On reconnect, Clawchestra reconciles local DB against OpenClaw's session — pulling messages it missed, resolving gaps from connection drops.

So: Clawchestra already caches chat locally AND reads from OpenClaw. The recovery cursor system handles sync.

### What this means for multi-device

When a second Clawchestra instance connects (e.g., mobile):
- It has an empty local chat.db (fresh install)
- It connects to OpenClaw with the same session key (`agent:main:clawchestra`)
- The recovery cursor pulls session history from OpenClaw and populates the local DB
- From that point, both devices have their own local cache, both reading from the same OpenClaw session

This already works architecturally. The session key ensures all clients tap into the same conversation.

### What needs consideration

- **Messages sent during OpenClaw downtime**: If a message is sent and OpenClaw is unreachable, it exists only in the local DB. When OpenClaw comes back, this message won't be in the remote session. The recovery cursor might not reconcile this direction (local -> remote).
- **Offline chat viewing**: The local chat.db enables this. A new device without chat.db can't view history offline until it's been populated from OpenClaw.
- **Chat.db in the sync payload**: The kanban DB (JSON) is separate from the chat DB (SQLite). They don't need to sync together. Chat syncs via OpenClaw sessions; kanban syncs via the data endpoint.

### When SQLite sync becomes relevant

Only if the local-to-remote direction matters — i.e., messages sent while offline need to appear on other devices. This is an edge case for now (single device, usually connected). For multi-device with frequent offline use, a proper message queue would be needed.

---

## 12. Git Branch Injection During Onboarding

### Project lifecycle contexts

Injection needs differ based on how the project enters Clawchestra:

**New project (born in Clawchestra):** User starts scoping an idea, creates a git repo later. Starts with 1 branch (main). Injection is trivial — one branch, instant. No UI complexity needed.

**Existing local repo:** User has a repo with several branches, adds it to Clawchestra. Moderate branch count (3-10 typical). Injection takes 10-30 seconds.

**Existing GitHub repo (the heavy case):** User imports a mature project with many branches (10-30+). This is where the UI matters — scanning, injecting, reporting takes 30-90 seconds. This is the case that needs progress indicators and background processing.

### When it happens

During the "Add Project" flow (whether in onboarding wizard or later via settings):

1. User points Clawchestra at a project directory
2. Clawchestra detects it's a git repo (optionally with GitHub remote)
3. Clawchestra asks: "This project has 15 branches. Inject agent guidance into all of them?"
4. User confirms
5. Clawchestra runs the injection loop (see Section 4)
6. Reports results

### UX: front-load injection behind other setup steps

For the heavy case (many branches), don't make the user stare at a progress bar. Instead:

1. Trigger the injection in the background
2. Present the next onboarding question(s) while injection runs
3. Show a subtle progress indicator (e.g., "Setting up agent guidance... 8/15")
4. If injection finishes before user completes other steps — great, seamless
5. If injection is still running when user finishes — show a brief "finishing up..." with the progress indicator

This makes the 30-90 second injection feel much shorter because the user is busy answering other questions.

### Onboarding implications

**If GitHub-connected project is the first project added (during onboarding):**
- OpenClaw may not be connected yet (depends on wizard step order)
- That's fine — injection uses git CLI only, no AI needed
- The wizard order should be: Connect OpenClaw -> Discover Projects -> Inject Guidance
- But even if OpenClaw isn't connected, injection still works

**If project is added later (via settings):**
- OpenClaw is likely connected
- Injection works the same way (git CLI)

### What the user sees

```
Setting up agent guidance for Revival Fightwear...

Scanning branches: 15 found (12 local, 3 remote-only)

Injecting into local branches:
  main .................. done
  staging ............... done
  feature/auth .......... done
  feature/payments ...... done
  ...
  legacy-v1 ............. skipped (uncommitted changes)
  experiment-2023 ....... skipped (detached HEAD)

Result: 10/12 local branches updated
2 branches skipped — see details

[Retry Failed] [Details] [Continue]
```

### Handling skipped branches — retry mechanism

Skipping is not the end state. Clawchestra should:

1. **Record which branches were skipped and why** (in Clawchestra's DB or settings)
2. **Surface a persistent notification**: "2 branches missing agent guidance" (visible in settings or project details)
3. **Offer "Retry" at any time**: User can revisit failed branches from project settings
4. **For uncommitted changes**: "This branch has uncommitted changes. Options: (a) Stash changes, inject, pop stash (b) Skip for now (c) I'll clean it up manually and retry"
5. **For detached HEAD**: "This branch is in a detached HEAD state. Skip for now — if you check it out normally later, retry from project settings."

The retry mechanism lives in the project settings panel, not just in onboarding. A user can come back days later and retry failed branches.

### Does this need AI to resolve?

**For standard failures (dirty branch, detached HEAD): No.** These are mechanical — stash-and-retry or skip.

**For unusual failures (CLAUDE.md merge conflicts on a branch that already has one with very different content): Possibly.** But this is extremely rare. If CLAUDE.md already exists, appending a section almost never conflicts. If it somehow does, the fallback is: skip, report, let user resolve manually or retry after cleaning up the branch.

### New branches: do they inherit?

**Standard workflow (`git checkout -b new-branch`):** Creates from current HEAD. If current branch has the CLAUDE.md section, new branch inherits it. This is the 99% case. No action needed.

**Orphan branches (`git checkout --orphan`):** Creates a branch with zero files. Extremely rare in normal development. The CLAUDE.md section won't exist. However, `.clawchestra/state.json` (gitignored, on disk) IS still visible — the agent can find the state file, it just won't know to look for it unless CLAUDE.md tells it.

**Branches created on remote (by other tools or people):** Won't have the injection. Same gap as pre-existing branches. The mitigation is the same: Clawchestra can periodically scan for branches missing the injection and offer to add it.

### Can state.json contain self-healing instructions?

The gitignored `state.json` is always on disk regardless of branch. It could contain a header comment or `_instructions` field that says "If your branch doesn't have .clawchestra guidance in CLAUDE.md, add the following section: [template]". This way, if an agent reads state.json directly (because it happens to look in `.clawchestra/`), it finds instructions to set up its own branch.

**Reliability of this approach**: Low. Agents don't scan for gitignored directories they don't know about. The primary injection mechanism (CLAUDE.md) is what works. state.json self-healing is a nice backup but not something to rely on.

---

## 13. Multi-Platform Roadmap

### Platform priority (Pierce's stated order)

1. **Desktop (macOS, Linux, Windows)** — nail this first
2. **Mobile (iOS first, Android second)** — separate apps, some reusable logic
3. **Web app** — last priority, not obvious users would prefer it over desktop

### What each platform needs

| Capability | Desktop | Mobile | Web |
|-----------|---------|--------|-----|
| Git CLI access | Direct | Via OpenClaw | Via OpenClaw |
| File system access | Direct | Via OpenClaw | Via OpenClaw |
| Local DB | SQLite (Tauri) | SQLite (native) | IndexedDB or remote |
| OpenClaw connection | HTTP/WS | HTTP/WS | HTTP/WS |
| Kanban interaction | Full | Full | Full |
| Code editing | No (external tools) | No | No |
| Git status display | Direct git | Via OpenClaw | Via OpenClaw |

### Trigger events for architecture upgrades

| Platform Milestone | Architecture Change Triggered |
|-------------------|------------------------------|
| Second desktop instance | Per-field timestamps for sync |
| Data endpoint extension | Build and deploy `~/.openclaw/extensions/data-endpoint.ts` |
| Mobile app development | Remote sync via data endpoint; UI settings per-device (Option B DB) |
| Web app development | Full remote API; consider operation-based sync if multi-user |
| Multi-user support | Operation-based sync or CRDTs; explicit conflict UI |

### "Login with OpenClaw" — cross-platform identity and sync

**Concept:** OpenClaw becomes the identity and sync provider for all Clawchestra clients. Instead of "Login with GitHub" or "Login with Google," users "Connect to OpenClaw" — and that single connection carries their identity, their projects, and their AI agent across every platform.

**How it works:**
1. User downloads Clawchestra (desktop, mobile, or web)
2. App asks: "Connect to your OpenClaw" → user provides connection details (URL + token, or scan a QR code, or paste a one-time code)
3. Clawchestra connects to OpenClaw, pulls project state from the database, establishes chat session
4. The user's projects, roadmap items, priorities — all there. Same as their desktop. Same AI agent. Same conversation history.

**The WhatsApp/Signal/Telegram analogy:** Those messaging apps already connect to OpenClaw as chat integrations. Clawchestra is another integration — but instead of just chat, it syncs project state bidirectionally. The user's OpenClaw instance becomes the hub that connects ALL their interfaces: desktop app, mobile app, Telegram, web — all talking to the same AI, all seeing the same projects.

**What "Login with OpenClaw" replaces:**
- No GitHub login needed (Git CLI auth is local; mobile/web don't need it for project tracking)
- No email/password accounts (no user database to manage, no auth server to run)
- No cloud dependency (OpenClaw IS the user's cloud — self-hosted, self-owned)

**What this enables long-term:**
- User checks roadmap on phone while commuting → sees their AI completed a build overnight
- User messages OpenClaw on Telegram: "what's left on Revival Fightwear?" → gets an answer because OpenClaw reads the same DB
- User opens Clawchestra web app on a borrowed laptop → connects to OpenClaw → full project visibility without installing anything
- All of this syncs automatically because every client reads from the same OpenClaw-hosted database

**When to build this:** Not now. The architecture direction (Phases 1-2) lays the foundation. The data endpoint, client identity, and session key model make all of this possible. The actual mobile/web apps are future roadmap items. But the architecture we're building now is designed with this end state in mind.

### Clawchestra as OpenClaw gateway

**Concept:** Clawchestra's onboarding can be a user's first introduction to OpenClaw. If someone downloads Clawchestra and doesn't have OpenClaw yet, the app doesn't just say "go install OpenClaw" — it facilitates the entire setup.

This makes Clawchestra a distribution channel for OpenClaw: every Clawchestra user is a potential OpenClaw user, and the onboarding friction of "install and configure an AI agent" gets absorbed into the app's setup wizard.

See roadmap item `openclaw-onboarding` for the deliverable tracking this work.

---

## 14. GitHub Login Utility

### Question: Should Clawchestra offer "Login with GitHub"?

**Assessment: No utility for current direction. "Login with OpenClaw" is the better model.**

What GitHub login would provide:
- Pre-authenticated git operations (already handled by `gh auth` / SSH keys)
- User identity (not needed — identity comes from OpenClaw connection)
- Repository discovery (already handled by scan paths + git remote detection)

What it would cost:
- OAuth flow implementation
- GitHub API dependency
- Privacy reduction (app now talks to GitHub's servers)

**Decision: Skip GitHub login. OpenClaw is the identity provider.** The OpenClaw connection carries identity, project state, and AI access. No external auth service needed. Git CLI with existing auth (SSH keys, `gh auth`) handles code operations. If GitHub login becomes useful later (e.g., for a web app that can't use local git CLI), it can be revisited — but "Login with OpenClaw" is the primary model.

---

## 15. Impact on First-Friend-Readiness

### Execution order

Architecture Direction runs to completion first, then First Friend Readiness. No interleaving.

### What Architecture Direction changes for FFR

**FFR spec changes needed** (update after Architecture Direction is complete):

| FFR Section | What Changes | Why |
|-------------|-------------|-----|
| Stage 3 (Discover Projects) | `PROJECT.md` references → `CLAWCHESTRA.md` | Rename happened in Architecture Direction |
| Stage 3 (Discover Projects) | Add branch injection step during "add project" flow | Agent guidance needs to be on all branches |
| Stage 2 (Connect to OpenClaw) | Add data endpoint extension setup (auto or guided) | Sync layer needs the endpoint |
| Stage 2 (Connect to OpenClaw) | Add OpenClaw system prompt injection | OpenClaw needs to know about Clawchestra |
| Phase 4 (Project Scaffolding) | Scaffold `CLAWCHESTRA.md` not `PROJECT.md` | File renamed |
| Phase 4 (Project Scaffolding) | Also scaffold `.clawchestra/state.json` or note it's auto-created | Agent projection file |
| Stage 5 (Ongoing Use) | Add sync status indicator (connected/syncing/offline) | User needs to know sync state |

**FFR plan changes needed** (`docs/plans/first-friend-readiness-plan.md`):

| Plan Phase | What Changes | Why |
|------------|-------------|-----|
| Phase 3 (Onboarding Wizard) | Step 1 (OpenClaw) must include data endpoint extension setup | Sync depends on it |
| Phase 3 (Onboarding Wizard) | Add step: "Do you already have OpenClaw? No → help set it up. Yes → configure connection." | Non-developer UX bar |
| Phase 4 (Project Scaffolding) | `PROJECT.md` → `CLAWCHESTRA.md` throughout | Rename |
| Phase 4 (Project Scaffolding) | Detect and offer branch injection for added projects | Agent guidance |
| All phases | References to scan-for-`PROJECT.md` logic → scan-for-`CLAWCHESTRA.md` | Rename |

### Onboarding philosophy (design principle for FFR)

**The bar is: someone who has OpenClaw running (or is willing to set it up) but has zero developer skills beyond that can get through onboarding.** The wizard should not assume developer proficiency. Specific requirements:

- All setup instructions live in the onboarding wizard, never in a README
- If the user doesn't have OpenClaw: the wizard facilitates setup (run installer, walk through config)
- If the user does have OpenClaw: "Give us the config" should be as simple as "run this one command, copy the output, paste it here"
- No step should require understanding what SSH, port forwarding, or file systems are
- Every action the user needs to take should be a single copy-paste command at most
- Access rights must be explicitly communicated (what Clawchestra will and won't do with their OpenClaw)
- The goal: by the time onboarding finishes, they have a working AI agent connection — so even if something needs debugging later, they can ask their AI for help

### Does NOT change (can defer)

- Multi-device sync (friend uses one device)
- Mobile app (friend uses desktop)
- Operation-based conflict resolution (single user, single device)

---

## 16. Decision Table

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| 1 | Orchestration state in Clawchestra DB, not git | **Confirmed** | Branch-independent, device-independent, single source of truth |
| 2 | `.clawchestra/state.json` as agent-facing projection | **Confirmed** | Gitignored = always on disk, branch-agnostic; agents read/write directly |
| 3 | Schema embedded in state.json structure | **Confirmed** | Self-documenting; no dependency on CLAWCHESTRA.md existing on every branch |
| 4 | Rename PROJECT.md -> CLAWCHESTRA.md | **Confirmed** | Human documentation of schema; not runtime-critical |
| 5 | CLAUDE.md as injection point for agents | **Confirmed** | Agents already read CLAUDE.md; add section pointing to state.json |
| 6 | Git branch injection during project setup | **Confirmed** | Checkout each branch, add files, commit; automated by Clawchestra |
| 7 | Stale roadmap risk acknowledged as real | **Confirmed** | Bounded by branch age; new branches inherit; old branches are known gap |
| 8 | Programmatic sync, not AI-inference sync | **Confirmed** | Data transfer = code; intent interpretation = AI; never sync DB via chat |
| 9 | OpenClaw data endpoint via plugin extension | **Confirmed — feasible** | ~100 lines TS; plugin SDK supports it; inherits auth; no core changes |
| 10 | Direct filesystem access when local | **Confirmed** | Zero overhead; used when Clawchestra + OpenClaw on same machine |
| 11 | HTTP data endpoint when remote | **Confirmed** | Simple GET/PUT on `/data/clawchestra/db.json`; used for VPS/remote |
| 12 | OpenClaw system prompt injection at setup | **Confirmed** | Teaches OpenClaw about Clawchestra, DB location, schema, roles |
| 13 | Client identity (UUID per instance) | **Confirmed** | Each Clawchestra instance identifies itself; enables multi-client awareness |
| 14 | Same OpenClaw session across devices | **Confirmed** | All Clawchestra instances use same session key; shared chat history |
| 15 | Full DB as JSON for sync payload | **Confirmed** | Trivially small (<1MB); readable, diffable, universal; no SQLite for sync |
| 16 | File-level locking for same-machine writes | **Confirmed** | Prevents race between Clawchestra UI and agents writing state.json |
| 17 | Per-field timestamps in state.json from day one | **Confirmed** | Low implementation cost upfront; prevents future migration pain; bot conflicts are already near-term |
| 18 | Bot/agent conflict is near-term concern | **Confirmed** | File locking mitigates on single machine; per-field timestamps prepare for cross-machine |
| 19 | Existing bot guidance in AGENTS.md stays | **Confirmed** | Bots already update roadmap items; mechanism changes, rules don't |
| 20 | Git status relevant for code, not orchestration | **Confirmed** | Branch checkout, ahead/behind still matter for code sync |
| 21 | Chat history: dual storage (local SQLite + OpenClaw sessions) | **Confirmed (already built)** | Local chat.db for instant display; OpenClaw sessions as canonical remote; recovery cursor reconciles |
| 22 | No GitHub login (privacy, no utility) | **Confirmed** | Git CLI auth sufficient; app stays private |
| 23 | Some architecture changes block first-friend-readiness | **Confirmed** | state.json, CLAUDE.md injection, rename, OpenClaw training — pre-friend |
| 24 | Multi-device sync deferred | **Confirmed** | Post-first-friend; triggered by second device |
| 25 | Mobile/web apps deferred | **Confirmed** | Desktop first; each platform triggers architecture upgrades |
| 26 | Desktop: iOS first, Android second, web last | **Confirmed** | Per Pierce's stated priority |
| 27 | Branch injection retry mechanism in project settings | **New — confirmed** | Skipped branches are tracked; user can retry anytime; persistent notification for missing branches |
| 28 | Front-load injection behind other onboarding steps | **New — confirmed** | Start injection in background, present next questions; makes 30-90s feel shorter |
| 29 | New branches inherit via standard git branching | **Confirmed** | `git checkout -b` copies current HEAD including CLAUDE.md; covers 99% of cases |
| 30 | Onboarding must not assume developer skills | **Confirmed** | Bar: someone with OpenClaw running but zero dev skills can complete onboarding |
| 31 | Access rights explicitly communicated in onboarding | **Confirmed** | Transparency about what Clawchestra will/won't do with OpenClaw access |
| 32 | Remote OpenClaw: self-setup via AI, not manual SSH | **Confirmed** | OpenClaw creates its own extension file; user does nothing beyond connecting |
| 33 | All setup instructions in wizard, never in README | **Confirmed** | Onboarding wizard is the single surface for all setup guidance |
| 34 | Branch injection progress must be visible, not silent | **Confirmed** | Show progress, confirm success, interactive on failure |
| 35 | OpenClaw setup facilitated in-app (not just "go install it") | **Confirmed** | If user doesn't have OpenClaw: wizard helps set it up or walks through it |
| 36 | ROADMAP.md removed after migration (Option 1) | **Confirmed** | Auto-generating back into git reintroduces branch fragmentation; kanban board IS the view |
| 37 | CHANGELOG.md absorbed into database | **Confirmed** | Completed items in DB enables cross-project queries; same migration as ROADMAP.md |
| 38 | Migration preserves Revival Fightwear files as backup | **Confirmed** | Safety net for critical project in case new system needs rollback |
| 39 | Database JSON is AI-readable for cross-project queries | **Confirmed** | OpenClaw reads db.json directly; "what are my P1s?" works from any interface |
| 40 | Completed items stay in DB (no file overflow) | **Confirmed** | No one-in-one-out; "changelog" is a query, not a file; revert = status change |
| 41 | GitSync survives — config changes, not rethink | **Confirmed** | Core commit/push/branch intact; kanban auto-commits removed; constants updated |

---

## 17. Resolved Questions (formerly open)

### Q1: Onboarding flow for GitHub-connected projects — RESOLVED

Branch injection happens whenever a project is added — during onboarding OR later via settings. Runs after user confirmation. Front-loaded behind other onboarding steps. Retry available in project settings.

**Progress visibility (per Pierce feedback):** The injection process must NOT be invisible. The user should know a process is running. UX:
- Show a visible progress indicator while injection runs (e.g., "Setting up agent guidance... 8/15 branches")
- If ALL branches succeed: confirm completion and auto-dismiss (e.g., "Agent guidance added to all 15 branches" → fades after 3 seconds)
- If SOME branches fail: the confirmation stays visible and interactive — user can see which branches failed, why, and retry them. Don't auto-dismiss failures.

### Q2: OpenClaw extension installation on remote — RESOLVED (revised)

**Previous answer (wrong):** "SSH in, create the file, instructions in README." This assumed developer skills and put instructions in the wrong place.

**Revised answer:** The user should never need to SSH into anything or manually create files. Three approaches in priority order:

1. **OpenClaw self-setup (preferred):** After Clawchestra connects to OpenClaw via WebSocket, it asks OpenClaw to create the data endpoint extension on its own filesystem. The user sees "Setting up data sync... done." Zero manual steps.

2. **One-command install (fallback):** If self-setup fails, the onboarding wizard shows a single copy-paste command to run on the machine where OpenClaw is running. Not "SSH in and create a file" — one command, shown in the wizard, not in a README.

3. **Local-mode via port forwarding (workaround):** If the user already has their remote OpenClaw accessible as if local (via SSH tunnel or Tailscale), they configure as "Local" and no extension is needed.

**Key design principles:**
- All instructions live in the onboarding wizard, never in a README
- No step assumes the user knows what SSH, filesystems, or extensions are
- Access rights are explicitly communicated (see Section 6)
- The wizard explains WHY each step is needed, not just WHAT to do

**Context — why this question exists:** Some users run OpenClaw on a remote server (VPS) rather than their local machine. In that case, Clawchestra can't directly write files to OpenClaw's filesystem — it needs either a data endpoint (HTTP API) running on the remote machine, or a way to make the remote machine appear local. This question is about how to set that up without burdening the user.

### Q3: Sync triggers — RESOLVED

- **On launch:** Pull from OpenClaw, compare with local, per-field merge using timestamps
- **On state change:** Write locally, push to OpenClaw (debounced 2 seconds)
- **On close:** Push final state
- **If unreachable:** Queue changes, retry on reconnect
- **Periodic polling:** Not needed until multi-device; add when second client exists

### Q4: state.json schema — RESOLVED (details at implementation planning)

- Fields mirror DB schema (simplified projection, no internal IDs)
- Per-field `updatedAt` timestamps (integer, milliseconds since epoch)
- Schema version field for forward compatibility (`_schemaVersion: 1`)
- Computed fields (git status, dirty counts) NOT included — these are runtime-only, not synced
- Exact field-by-field definition happens during implementation planning

### Q5: VPS friend connection — RESOLVED (revised)

**Previous answer (wrong):** "SSH tunnel sufficient, instructions in README." Same problem as Q2 — assumed developer skills, wrong location for instructions.

**Revised answer:** Aligned with Q2. The onboarding wizard handles everything:

1. Wizard asks: "Where is your OpenClaw running?" → "On this machine" / "On a remote server"
2. If remote: wizard asks for connection details (URL, token) — explained in plain language with copy-paste commands
3. After connecting: Clawchestra asks OpenClaw to self-setup the data endpoint (see Q2 approach #1)
4. If self-setup fails: wizard walks user through the one-command fallback
5. All of this is in the wizard UI — no README, no external docs needed for the happy path

**Why "VPS" keeps coming up:** Some technically savvy users run OpenClaw on a cloud server (VPS) instead of their laptop. This gives them 24/7 AI availability and the ability to connect from multiple devices. It's a common setup for developers but the onboarding shouldn't assume the user understands the technical details — just "is OpenClaw on this computer or somewhere else?"

---

## 18. Trigger Events: When to Upgrade Architecture

This table maps real-world milestones to the architecture changes they trigger. Use this to decide what to build when.

| Milestone | Architecture Upgrade | Effort | Blocking? |
|-----------|---------------------|--------|-----------|
| **First friend tests (local OpenClaw)** | state.json, CLAUDE.md injection, rename, OpenClaw training | Medium | Yes — do before handoff |
| **First friend tests (VPS OpenClaw)** | Data endpoint extension, remote connection setup | Small | Depends on friend's setup |
| **Pierce uses second desktop** | Per-field timestamps in sync payload | Small | No — LWW works until this happens |
| **Mobile app development begins** | Data endpoint (if not built), remote sync, per-device UI settings | Medium | Yes — blocks mobile |
| **Second user added to same kanban** | Operation-based sync, conflict UI | Large | Yes — blocks multi-user |
| **Autonomous bots run frequently on same machine** | File locking on state.json | Small | Partially — already relevant |
| **Autonomous bots run on different machines** | Operation log or per-field timestamps | Medium | Not yet relevant |
| **Chat history grows large** | Local SQLite cache for offline chat access | Medium | Not yet relevant |
| **Web app development begins** | Full remote API, authentication, CORS | Large | Yes — blocks web |

---

## 19. Second and Third-Order Effects

This section captures the cascading impacts of the architecture direction on existing code, files, and workflows. These MUST be explicit steps in the implementation plan — not afterthoughts.

### 19.1 PROJECT.md → CLAWCHESTRA.md rename

**Direct impact:**
- `lib.rs` scan logic currently looks for `PROJECT.md` files to discover projects. Must scan for `CLAWCHESTRA.md` instead.
- Every existing project currently has a `PROJECT.md`. These files need migrating (rename + content update).
- The `scan_for_projects` function, `load_project`, and any path constants referencing `PROJECT.md` must be updated.

**Migration path:**
- Support BOTH filenames during a transition period: scan for `CLAWCHESTRA.md` first, fall back to `PROJECT.md`
- Offer auto-rename: when Clawchestra finds a `PROJECT.md` without a `CLAWCHESTRA.md`, offer to rename it
- After transition period (once all projects are migrated), remove `PROJECT.md` fallback

**Second-order:**
- AGENTS.md references to `PROJECT.md` need updating in every project repo
- CLAUDE.md sections that mention `PROJECT.md` (if any) need updating
- Any automation or scripts that generate/read `PROJECT.md` break

**Third-order:**
- Friends who clone a project repo will see `CLAWCHESTRA.md` and need to understand it's a Clawchestra schema file, not a random doc. The filename is self-documenting (good).

### 19.2 ROADMAP.md → state.json transition

**Direct impact:**
- Currently agents write to `ROADMAP.md` (YAML frontmatter). After the change, agents write to `.clawchestra/state.json`.
- The AGENTS.md guidance in every project repo says "edit ROADMAP.md to update roadmap items." This becomes wrong.
- Clawchestra currently parses `ROADMAP.md` YAML frontmatter to populate the DB. The ingest path changes to reading `state.json` (or agents reading state.json, Clawchestra writing state.json).

**Decision: Option 1 — remove ROADMAP.md entirely.** The kanban board is the roadmap view. Auto-generating ROADMAP.md back into git reintroduces branch fragmentation. Source of truth is the database; agent-facing projection is state.json; ROADMAP.md goes away.

**Migration path:**
- On first open post-architecture-change: Clawchestra imports `ROADMAP.md` YAML data from all tracked projects into the DB
- Delete `ROADMAP.md` from all projects EXCEPT Revival Fightwear (Shopify Fabric theme) — kept as historical backup in case the new system needs rollback
- Migration is automatic, not user-prompted — Clawchestra detects `ROADMAP.md` exists, imports, removes
- Same treatment for `CHANGELOG.md` (see Section 19.8)

**Second-order:**
- The git sync dialog currently categorizes `ROADMAP.md` as a "Metadata" file. Remove it from `METADATA_FILES` constant after migration.
- The `categorize_dirty_file` function in `lib.rs` has `ROADMAP.md` in `METADATA_FILES`. Remove after migration.
- Any lifecycle prompts that reference "update ROADMAP.md" need to reference state.json instead.

### 19.3 AGENTS.md / CLAUDE.md guidance updates

**Direct impact:**
- Every project repo has AGENTS.md or CLAUDE.md sections that tell agents how to interact with project state. These currently say "edit ROADMAP.md" and "read PROJECT.md."
- After the architecture change, they need to say "read/write .clawchestra/state.json" and "read CLAWCHESTRA.md for schema documentation."

**Migration path:**
- The CLAUDE.md injection loop (Section 4) handles this for branches that get injected
- But existing AGENTS.md content in project repos is not automatically updated by injection — it needs explicit migration
- Consider: should the injection loop also update AGENTS.md, or just CLAUDE.md?

**Second-order:**
- If agents on old branches still follow old AGENTS.md guidance, they'll try to edit ROADMAP.md (which may not exist anymore). The consequence: agent writes fail silently, or create a stale ROADMAP.md that Clawchestra ignores.
- The compliance block in CLAUDE.md (synced from AGENTS.md via `sync-agent-compliance.sh`) needs updating.

### 19.4 Git sync dialog file categorization

**Direct impact:**
- `categorize_dirty_file` in `lib.rs` classifies files into Code, Metadata, and Documents.
- `METADATA_FILES` includes `ROADMAP.md` and `PROJECT.md`. After rename/migration, these constants need updating.
- `.clawchestra/state.json` is gitignored, so it never appears in git status. No categorization needed for it.

**Second-order:**
- `CLAWCHESTRA.md` should be categorized as Metadata (replacing `PROJECT.md`).
- Remove `ROADMAP.md` and `CHANGELOG.md` from `METADATA_FILES` (files no longer exist post-migration).

### 19.4a GitSync behavioral changes (kanban auto-commits, badge, overall model)

**The 3-phase GitSync feature (commit + scope + branch management) survives the architecture change.** It does NOT need a complete rethink. The core value — "commit and push your code changes from within the app" — is unchanged. What changes is configuration and trigger behavior.

**Kanban auto-commits go away:**
- Currently: dragging a kanban item → dirty `ROADMAP.md` → auto-commit or manual sync → badge appears
- After: dragging a kanban item → DB write + state.json update (gitignored) → NO git changes
- The structural auto-commit logic for board moves becomes dead code — remove it
- This is a simplification: GitSync only fires for real file changes, not kanban noise

**Badge behavior changes:**
- Currently: badge appears frequently because every kanban drag dirties `ROADMAP.md`
- After: badge only appears when actual code/docs/metadata files change
- The red badge (unresolved sync) and orange badge (dirty files) logic stays — just triggers less often
- The `scanUnresolvedSyncState` and `check_for_update` logic is unaffected (still checks git HEAD)

**Metadata category shrinks:**
- Before: `ROADMAP.md`, `CHANGELOG.md`, `PROJECT.md`, `AGENTS.md` (4 files)
- After: `CLAWCHESTRA.md`, `AGENTS.md` (2 files)
- The 3-category model (Metadata/Documents/Code) still works, just thinner Metadata

**What stays unchanged in GitSync:**
- Commit + push flow
- Branch management (cherry-pick to other branches)
- Code category (unchecked by default)
- Documents category (specs, plans, roadmap detail files)
- Sync lifecycle state (localStorage persistence, BranchSyncStep tracking)
- The sync dialog UI and UX

**Implementation: all changes are constant/config updates, not architectural:**
1. Update `METADATA_FILES` in `lib.rs` (remove ROADMAP.md, CHANGELOG.md, rename PROJECT.md → CLAWCHESTRA.md)
2. Remove kanban auto-commit trigger logic (dead code after migration)
3. Update `check_for_update` if it references ROADMAP.md for data-only commit suppression
4. Review badge trigger — ensure it handles the reduced change frequency gracefully

### 19.5 Lifecycle prompts

**Direct impact:**
- `deliverable-lifecycle.ts` generates prompts that reference project files. Any references to "update ROADMAP.md" or "edit PROJECT.md" need updating.

**Migration path:**
- Update prompt templates to reference state.json for agent-facing operations
- Update references to CLAWCHESTRA.md for human-readable schema documentation
- This is part of the larger FFR lifecycle button overhaul (Phase 5B) but the underlying prompt templates change here

### 19.6 lib.rs hardcoded paths and constants

**Direct impact:**
- `METADATA_FILES`, `DOCUMENT_FILES`, `DOCUMENT_DIR_PREFIXES` constants define how files are categorized
- `scan_for_projects` and related functions look for specific filenames
- `get_current_git_head`, `check_for_update`, and other functions may reference project file paths

**Audit needed during implementation planning:**
- Grep for `PROJECT.md`, `ROADMAP.md`, `project.md`, `roadmap.md` across entire codebase
- Identify every reference and classify as: needs-update, needs-removal, or unchanged
- Include frontend code (`*.ts`, `*.tsx`) in the audit, not just Rust

### 19.7 Test suite

**Direct impact:**
- Any tests that create, read, or assert against `PROJECT.md` or `ROADMAP.md` files need updating
- Test fixtures that include these files need migration

**Audit needed:**
- `bun test` passes today — identify which tests reference these files and flag them for update during implementation

### 19.8 CHANGELOG.md → database (completed item lifecycle)

**Current approach (file-based):**
- Items marked `status: complete` live in ROADMAP.md's complete column
- When the complete column reaches ~10 items, the oldest get moved to CHANGELOG.md (one-in-one-out)
- Reverting a completed item means manually moving it from CHANGELOG.md back to ROADMAP.md
- This is tedious, error-prone, and creates YAML formatting issues

**New approach (database):**
- ALL items — active and completed — live in the same database
- A completed item has `status: complete` and `completedAt: YYYY-MM-DD`. That's it.
- There is no physical separation between "active" and "archived." No file migration.
- The one-in-one-out pattern disappears entirely.

**Display:** The kanban UI shows the N most recent completed items (display limit, not data limit). Older completed items are still in the DB — accessible via "show all completed" or by querying OpenClaw.

**Reverting a completed item:** Change `status` from `complete` to `up-next` / `in-progress` / etc., clear `completedAt`. One field change. Works by dragging on the kanban or asking OpenClaw: "reopen the auth item." No file surgery.

**"Changelog" becomes a query, not a file:** "What did I ship last week?" = query completed items by `completedAt` date. "Show me everything I completed on Revival Fightwear" = filter by project + status. Cross-project changelog queries become trivial — impossible with the current file-per-repo approach.

**Migration:**
- On first open post-architecture: import `CHANGELOG.md` entries into DB as completed items (preserving `completedAt` dates)
- Delete `CHANGELOG.md` from all projects (except Revival Fightwear backup)
- `CHANGELOG.md` is in `METADATA_FILES` constant — remove after migration
- The CLAUDE.md compliance block references `CHANGELOG.md` as the completed items file — update to reference the database

**Why this is better:**
- No data physically moves when items complete — just a status field change
- No overflow logic (one-in-one-out) to maintain
- Reverting is instant — no cut/paste between files
- Cross-project completed item queries work natively
- OpenClaw can answer "what did I ship across all projects this month?" from one DB read

### Summary: implementation plan must include

1. Codebase audit: grep for all `PROJECT.md`, `ROADMAP.md`, and `CHANGELOG.md` references
2. Transition period with dual-filename support for `PROJECT.md` / `CLAWCHESTRA.md`
3. One-time migration tool: `ROADMAP.md` YAML + `CHANGELOG.md` YAML → Clawchestra DB → `state.json`
4. Delete `ROADMAP.md` and `CHANGELOG.md` from all projects post-migration (except Revival Fightwear as backup)
5. AGENTS.md content migration (in addition to CLAUDE.md injection)
6. Git sync dialog: update `METADATA_FILES` constants, remove kanban auto-commit trigger, review badge behavior
7. Lifecycle prompt template updates
8. Test fixture updates
9. Remove dead kanban-auto-commit code paths after migration

---

*This document is the canonical reference for Clawchestra's architectural direction. Update it as decisions evolve.*
