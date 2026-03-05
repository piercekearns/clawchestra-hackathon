# VPS OpenClaw File Access Bridge

> Enable VPS-hosted OpenClaw instances to access project files that live on the user's local machine or on GitHub, so that all Clawchestra users get a meaningful cross-project assistant experience regardless of OpenClaw deployment topology.

**Status:** Discovery (problem defined, solutions enumerated, not yet evaluated)
**Created:** 2026-03-05
**Roadmap Item:** `vps-openclaw-file-access`
**Related:** `app-aware-ai-context` (Layer 8: Deployment Topology)

---

## The Problem

Clawchestra is a local desktop app. OpenClaw may run locally (same machine) or on a remote VPS. When OpenClaw runs locally, it has direct filesystem access to all project directories — it can read source code, write specs, analyse codebases across projects. When OpenClaw runs on a VPS, it has none of this.

Clawchestra already pushes project metadata (state.json, CLAWCHESTRA.md, specs, plans) into chat messages, so the **app-aware assistant** role works regardless of deployment. But the **cross-project assistant** role — "compare how project X handles auth vs project Y", "read the README for this repo and summarise it" — requires file access that VPS-hosted OpenClaw doesn't have.

**Important distinction:** Terminal agents (Claude Code, Codex) always run locally in Clawchestra's tmux sessions on the user's machine. They always have full file access. The gap is specifically about OpenClaw's ability to read/write files when it lives on a different machine.

**Also important:** Clawchestra is a UI app, not a powered agent. It can't intercept OpenClaw tool calls or fulfil file-read requests on OpenClaw's behalf without significant architectural changes.

---

## Experience Gap

| Capability | Local OpenClaw | VPS OpenClaw |
|------------|---------------|--------------|
| App-aware assistant (via pushed context) | ✅ | ✅ |
| Project metadata (state.json, docs) | ✅ | ✅ (pushed) |
| Read arbitrary source files | ✅ | ❌ |
| Cross-project code analysis | ✅ | ❌ |
| Write files / make code changes | ✅ | ❌ |
| Terminal agents (Claude Code, Codex) | ✅ | ✅ (always local) |

---

## Solution Options

### 1. MCP Filesystem Server (Tunnel-Based)

The user runs an MCP filesystem server locally that their VPS-hosted OpenClaw connects to via secure tunnel (SSH tunnel, Tailscale, WireGuard, Cloudflare Tunnel, etc.).

**How it works:** OpenClaw on VPS has an MCP tool that reads/writes files on the user's local machine via the tunnel. Clawchestra could assist setup by detecting VPS deployment and guiding the user through tunnel configuration.

**Pros:** Full file access, read + write, works with any project directory.
**Cons:** Requires tunnel setup (networking knowledge), latency for file operations, security surface (exposing local filesystem to remote agent), user must keep tunnel running.

### 2. GitHub API / GitHub MCP Integration

OpenClaw on VPS uses GitHub's API (or a GitHub MCP server) to read files from repositories hosted on GitHub.

**How it works:** Projects tracked in Clawchestra that have GitHub remotes can be accessed by OpenClaw via the GitHub API. Clawchestra could inject repo URLs into context so OpenClaw knows where to look.

**Pros:** No tunnel needed, works for any GitHub-hosted repo, read access is reliable, can also create branches/commits via API.
**Cons:** Only works for GitHub-hosted repos (not local-only projects), doesn't see uncommitted changes, API rate limits, write operations are clunky (commit via API, not local file edit), requires GitHub auth token on VPS.

### 3. Git Clone on VPS

OpenClaw clones project repositories onto the VPS, giving it local file access in its own environment.

**How it works:** When OpenClaw needs to work with a project, it clones (or pulls) the repo from GitHub onto the VPS. Clawchestra injects repo URLs to facilitate this.

**Pros:** Full file access once cloned, familiar git workflow, can make local changes on VPS.
**Cons:** Sync headaches (who pulls? when?), doesn't see local uncommitted changes, storage on VPS, only works for git-hosted repos, divergence risk between local and VPS copies.

### 4. Enhanced Context Injection (Push More Files)

Clawchestra pushes more file content into chat messages — beyond the current metadata, also include key source files, READMEs, configs, etc.

**How it works:** Extend `hub-context.ts` to include more project files in the first-send injection. Could be configurable per-project (which files to include) or smart (include files relevant to the conversation topic).

**Pros:** Works regardless of OpenClaw deployment, no setup required, Clawchestra controls what's shared.
**Cons:** Context window limits (currently 12k chars), can't push entire codebases, user can't ask for arbitrary files mid-conversation, increases token cost.

### 5. Clawchestra as File Proxy (Architectural Change)

Clawchestra exposes a local API/WebSocket endpoint that OpenClaw can call to request file reads.

**How it works:** OpenClaw sends a structured request ("read file X from project Y") → Clawchestra receives it → reads the file locally → sends content back in the next message or via a side channel.

**Pros:** Elegant, Clawchestra becomes the bridge, works for all local files.
**Cons:** Significant architectural change (Clawchestra needs to understand and respond to OpenClaw tool requests), security considerations (which files can be read?), requires a new protocol between Clawchestra and OpenClaw, Clawchestra is currently a UI app not a server.

### 6. Recommend Local OpenClaw (Documentation-Only)

Document the tradeoff clearly and recommend local OpenClaw for the full experience.

**How it works:** Onboarding and docs explain that VPS-hosted OpenClaw provides the app-aware assistant experience but limited file access. For full cross-project analysis and coding, local OpenClaw is recommended. Terminal agents (always local) partially compensate.

**Pros:** No engineering work, honest about tradeoffs, lets users make informed choice.
**Cons:** Doesn't solve the problem, limits the product for VPS users.

---

## Evaluation Criteria

When choosing which solution(s) to pursue:

1. **User effort** — How much setup does the user need to do?
2. **Coverage** — Does it work for all projects (local + GitHub) or only some?
3. **Latency** — Is file access fast enough for conversational use?
4. **Security** — What's the attack surface of exposing local files to a remote agent?
5. **Maintenance** — Does the solution create ongoing sync/maintenance burden?
6. **Architectural fit** — Does it align with Clawchestra's current architecture or require significant rearchitecting?

---

## Open Questions

1. What percentage of target users will run OpenClaw on VPS vs locally? If most run locally, this may be lower priority.
2. Can solutions be combined? (e.g., GitHub API for GitHub repos + enhanced context injection for local-only projects)
3. Should Clawchestra detect deployment topology automatically and adapt the experience?
4. Is the terminal agent compensating enough? (VPS users use OpenClaw for planning, Claude Code terminals for file work)
5. What does OpenClaw's own roadmap say about remote file access patterns?
