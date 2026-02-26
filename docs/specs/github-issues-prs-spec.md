# GitHub Issues & PR Integration

> Pull GitHub issues, pull requests, and review comments into Clawchestra — linked to projects and roadmap items, surfaced alongside development context, scoped with a dev collaborator.

**Status:** Draft (directional — scoping TBD with dev collaborator)
**Created:** 2026-02-26
**Last Updated:** 2026-02-26
**Roadmap Item:** `github-issues-prs`
**Depends On:** `project-conversation-hub` (sidebar for PR/issue display), `embedded-agent-terminals` (agent sessions that produce PRs)

---

## Problem

Clawchestra manages projects and roadmap items, and embedded terminals produce code changes that become PRs. But GitHub activity — issues, PRs, review comments — lives entirely outside the app. The user has to context-switch to GitHub to:

1. **See PR status** — is the PR I asked Claude Code to create actually open? Has it been reviewed? Are there failing checks?
2. **Read review comments** — a collaborator left feedback on a PR, but the user doesn't see it until they go to GitHub.
3. **Track issues** — GitHub issues related to a roadmap item aren't visible from that item's card or conversation thread.
4. **Understand relationships** — which PRs belong to which roadmap items? Which issues are blocking progress?

## What Success Looks Like

- Project cards show a badge with open PR/issue counts.
- Roadmap item cards show linked PRs and issues (auto-linked by branch name or manual linking).
- PR details (status, checks, review state, comments) are viewable from within Clawchestra without opening GitHub.
- Review comments surface as notifications or inline in the relevant conversation thread.
- OpenClaw can reference PR/issue context when discussing a roadmap item ("the PR has 2 failing checks — here's what they are").

## Data Model

### GitHub Connection

Each project can have one or more linked GitHub repositories (most projects have exactly one). The connection stores:

- Repository owner/name (e.g., `piercekearns/clawchestra`)
- Authentication method (GitHub token from existing git config, or explicit PAT)
- Sync preferences (which events to pull, polling interval)

### Entities to Sync

| Entity | Key Fields | Linked To |
|--------|-----------|-----------|
| Pull Request | number, title, state, author, branch, checks status, review state, created/updated timestamps | Project (by repo), optionally Roadmap Item (by branch name or manual link) |
| PR Review Comment | body, author, path, line, created timestamp | Parent PR |
| Issue | number, title, state, labels, author, created/updated timestamps | Project (by repo), optionally Roadmap Item (by label or manual link) |
| Issue Comment | body, author, created timestamp | Parent Issue |

### Auto-Linking Strategy

PRs and issues are auto-linked to roadmap items using heuristics:

- **Branch name** — if a PR's branch contains the roadmap item's ID (e.g., `feat/git-sync` matches item `git-sync`), auto-link it.
- **Labels** — if an issue has a label matching a roadmap item ID, auto-link it.
- **Title mentions** — if a PR/issue title contains the item ID, auto-link it.
- **Manual override** — the user can always manually link/unlink PRs and issues to roadmap items.

Auto-linking is surfaced as a suggestion ("This PR looks related to git-sync — link it?") rather than silently applied, at least in Phase 1.

## UI Surfaces

### On Project Cards (Kanban Board)

- Badge showing open PR count and open issue count (e.g., `PR 3 · Issues 5`)
- Click to expand a summary in the sidebar

### On Roadmap Item Cards (Priority List)

- Linked PR indicators with status icons (open/merged/closed, checks passing/failing, review approved/changes-requested)
- Linked issue indicators
- Click to see details in sidebar

### In Conversation Hub Sidebar

- Dedicated "GitHub" tab or section within a project thread
- List of open PRs with: title, author, branch, checks status, review state
- List of open issues with: title, labels, assignee
- Click a PR or issue to see full details + comments inline

### PR Detail View

```
┌─ PR #42: Add conversation hub sidebar ───┐
│ feat/conversation-hub → main              │
│ Status: Open · Checks: 2/3 passing        │
│ Review: Changes requested by @collaborator│
│                                           │
│ Review Comments (3)                       │
│ ┌────────────────────────────────────────┐│
│ │ @collaborator on src/App.tsx:145       ││
│ │ "This should use the existing store    ││
│ │  method instead of inline state"       ││
│ │                           2 hours ago  ││
│ └────────────────────────────────────────┘│
│ ┌────────────────────────────────────────┐│
│ │ @collaborator on src/lib/gateway.ts:32 ││
│ │ "Consider adding a timeout here"       ││
│ │                           2 hours ago  ││
│ └────────────────────────────────────────┘│
│                                           │
│ [Open in GitHub ↗]  [Ask OpenClaw about →]│
└───────────────────────────────────────────┘
```

### "Ask OpenClaw" Integration

From any PR or issue detail view, a button sends the PR/issue context (diff summary, review comments, check failures) to an OpenClaw chat scoped to that roadmap item. This lets the user say "address these review comments" and have OpenClaw (or a terminal session) act on it with full context.

## API Strategy

Use the GitHub REST API via the `gh` CLI (already available on the system) or direct HTTP calls with the user's existing GitHub authentication.

| Endpoint | Purpose |
|----------|---------|
| `GET /repos/{owner}/{repo}/pulls` | List PRs |
| `GET /repos/{owner}/{repo}/pulls/{number}` | PR details |
| `GET /repos/{owner}/{repo}/pulls/{number}/reviews` | PR reviews |
| `GET /repos/{owner}/{repo}/pulls/{number}/comments` | PR review comments |
| `GET /repos/{owner}/{repo}/issues` | List issues |
| `GET /repos/{owner}/{repo}/issues/{number}/comments` | Issue comments |
| `GET /repos/{owner}/{repo}/actions/runs` | Check/CI status |

### Sync Strategy

- **Polling** — periodic fetch (configurable, default every 5 minutes)
- **On-demand** — manual refresh button, also triggered when opening a project thread
- **Webhooks (future)** — if Clawchestra ever has a server component, GitHub webhooks would replace polling. Not in scope for a local desktop app.

### Rate Limiting

GitHub's API has rate limits (5000 req/hr for authenticated users). With polling, this is unlikely to be an issue for a single user, but the sync logic should:
- Track remaining rate limit via response headers
- Back off gracefully if approaching the limit
- Show a warning if rate-limited

## Decisions

### 1. Read-only in Phase 1
Phase 1 is read-only: view PRs, issues, and comments. No creating, commenting, or merging from within Clawchestra. That's Phase 2+.

### 2. gh CLI for authentication
Leverage the user's existing `gh` CLI authentication rather than asking for a separate token. Falls back to git credential helper if `gh` isn't installed.

### 3. Auto-link suggestions, not silent linking
Auto-linking PRs/issues to roadmap items is presented as a suggestion, not silently applied. The user confirms or dismisses.

### 4. Scoping TBD with dev collaborator
The detailed scoping of this feature — especially the collaborative aspects (how review comments trigger notifications, how to handle multi-reviewer workflows) — is to be refined with a dev collaborator. This spec captures the directional intent.

## Phased Delivery

### Phase 1: Read-Only PR & Issue Visibility
- GitHub repo linking per project (settings UI)
- Rust commands to fetch PRs and issues via GitHub API
- PR/issue list in conversation hub sidebar
- Basic PR detail view (title, status, checks, review state)
- Auto-link suggestions for roadmap items
- Polling-based sync

### Phase 2: Comments & Notifications
- PR review comments displayed inline
- Issue comments displayed
- Notification when new review comments arrive on linked PRs
- "Ask OpenClaw" button to send PR/issue context to a scoped chat

### Phase 3: Actions & Deep Integration
- Create issues from roadmap items
- Comment on PRs from within Clawchestra
- Merge PRs (with confirmation) from the PR detail view
- CI/CD status details (individual check results, logs link)
- PR creation from embedded terminal sessions (agent creates PR → auto-linked to the item)

## Non-Goals

- Replacing GitHub's UI for complex workflows (merge conflicts, code review line-by-line, PR templates)
- Supporting non-GitHub hosts (GitLab, Bitbucket) in Phase 1 — architecture should not prevent it, but not built
- GitHub Actions management (workflow editing, re-runs) — out of scope
- Repository management (settings, permissions, branches) — out of scope

## Open Questions

1. **Multi-repo projects** — Some projects may span multiple GitHub repos. How should this work? Probably: a project can link to N repos, PRs/issues from all linked repos appear in the project thread.
2. **Stale data tolerance** — How stale can PR/issue data be before the UX feels broken? 5-minute polling seems reasonable, but review comments might need faster updates during active review sessions.
3. **Collaborator workflows** — Detailed scoping with dev collaborator needed. How do review request notifications work? How does the user track "I need to address these comments"?
4. **Offline behavior** — When the user is offline, show last-synced data with a "last updated X minutes ago" indicator? Or hide the GitHub section entirely?
