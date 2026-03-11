# Review: karpathy/agenthub

**Repo:** [github.com/karpathy/agenthub](https://github.com/karpathy/agenthub)
**Author:** Andrej Karpathy
**Status:** Exploratory sketch (~1,500 stars as of March 2026)

---

## What it is

AgentHub is an agent-first collaboration platform. Tagline: "GitHub is for humans. AgentHub is for agents."

It provides a bare git repo + message board designed for swarms of AI agents working on the same codebase. There are no branches, no PRs, no merges -- just a sprawling DAG of commits going in every direction, with a message board for coordination.

The first use case is organizing [autoresearch](https://github.com/karpathy/autoresearch), Karpathy's tool for autonomous LLM pretraining experiments on a single GPU. Where autoresearch emulates a single PhD student, AgentHub emulates a research community of them.

## Architecture

Deliberately minimal:

| Component | Choice |
|-----------|--------|
| Language | Go (single static binary) |
| Database | SQLite (single file) |
| Storage | One bare git repo on disk |
| CLI | `ah` tool wrapping the HTTP API |

**Project structure:**

```
cmd/agenthub-server/main.go     -- server binary
cmd/ah/main.go                  -- CLI binary
internal/db/db.go               -- SQLite schema + queries
internal/auth/auth.go           -- API key middleware
internal/gitrepo/repo.go        -- bare git repo operations
internal/server/server.go       -- router + helpers
internal/server/git_handlers.go -- git API handlers
internal/server/board_handlers.go -- message board handlers
internal/server/admin_handlers.go -- agent creation
```

## Key Features

### Git layer (code sharing)

- `ah push` -- push HEAD commit via git bundles
- `ah fetch <hash>` -- fetch a commit
- `ah log [--agent X] [--limit N]` -- recent commits
- `ah children <hash>` -- see what has been tried on top of a commit
- `ah leaves` -- frontier commits (no children yet)
- `ah lineage <hash>` -- ancestry path to root
- `ah diff <hash-a> <hash-b>` -- diff two commits

### Message board (coordination)

- `ah channels` -- list channels
- `ah post <channel> <message>` -- post to a channel
- `ah read <channel> [--limit N]` -- read posts
- `ah reply <post-id> <message>` -- reply to a post

### Auth

API key per agent, rate limiting, bundle size limits.

## Design Decisions Worth Noting

1. **No human workflow concepts.** Deliberately strips away PRs, merges, main branches, code review. These are human collaboration patterns; agents need different primitives (DAG traversal, frontier discovery, diffing).

2. **Git bundles for transport.** Instead of standard git push/pull protocol, agents exchange code via git bundles over HTTP -- simpler and more portable.

3. **Single-binary deployment.** Go binary + SQLite file + bare git directory = trivially deployable. No containers, no runtime.

4. **Agent-first primitives.** Commands like `leaves` (find unexplored frontiers), `children` (see what has been tried), and `lineage` (trace back to root) are designed for how agents think about exploration.

5. **Platform-agnostic.** The platform doesn't know or care what agents are optimizing. The "culture" comes from agent instructions, not the platform.

6. **Decentralized contribution.** Anyone on the internet can run their own agent and push results to the shared hub.

## Relevance to Clawchestra

AgentHub and Clawchestra operate in adjacent but distinct spaces:

| | Clawchestra | AgentHub |
|---|---|---|
| **Target user** | Humans orchestrating agents | Agents collaborating autonomously |
| **UI** | Rich desktop app (Tauri + React) | CLI only (`ah` tool) |
| **Workflow** | Kanban boards, specs, project management | DAG of commits + message board |
| **Agent model** | Human launches and scopes agents to roadmap items | Agents self-organize and coordinate via message board |
| **State** | JSON project state synced via OpenClaw | SQLite + bare git repo |
| **Code collaboration** | Standard git (branches, PRs) | Branchless DAG (no PRs, no merges) |

### Potential integration ideas

1. **AgentHub as a backend for autonomous agent swarms.** Clawchestra could launch agents that push results to an AgentHub instance, then surface the DAG of experiments in the Kanban UI. This would give human operators visibility into what autonomous agents are discovering.

2. **DAG visualization.** AgentHub's commit DAG could be rendered as a visual graph in Clawchestra, letting users see the branching exploration of agent experiments and pick promising directions to pursue.

3. **Message board in sidebar.** AgentHub's coordination messages could be surfaced alongside the terminal sessions and chat, giving humans a window into agent-to-agent communication.

4. **Frontier discovery for task assignment.** The `leaves` concept (frontier commits nobody has built on) maps naturally to a Kanban "ready" column -- commits that need attention could become cards.

### Key takeaway

AgentHub validates a core thesis: agents need different collaboration primitives than humans. The branchless DAG, frontier discovery, and message board are purpose-built for autonomous exploration. Clawchestra's strength is the human-in-the-loop orchestration layer. The two approaches are complementary -- Clawchestra could serve as the human control plane for agent swarms that collaborate via AgentHub-style primitives.
