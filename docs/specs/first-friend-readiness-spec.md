# First Friend Readiness

> Make Clawchestra installable, configurable, and usable by someone who isn't Pierce.

## Summary

Clawchestra is currently a single-user app designed entirely around Pierce's local macOS setup — hardcoded paths, macOS-only title bar chrome, localhost-only OpenClaw connection, lifecycle buttons that assume Claude Code and Compound Engineering are installed. This spec identifies every gap between "works on Pierce's machine" and "a friend on Linux or Windows can install it, connect their own OpenClaw instance, point it at their projects, and use it." It organises the work into a sequential onboarding funnel (Get → Launch → Connect → Discover → Customise) and distinguishes what's mandatory for the first handoff vs what can come later.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Draft
**Created:** 2026-02-19

---

## Table of Contents

1. [End-to-End User Journey](#1-end-to-end-user-journey)
2. [Stage 0: Get the App](#2-stage-0-get-the-app)
3. [Stage 1: First Launch](#3-stage-1-first-launch)
4. [Stage 2: Connect to OpenClaw](#4-stage-2-connect-to-openclaw)
5. [Stage 3: Discover Projects](#5-stage-3-discover-projects)
6. [Stage 4: Customise Lifecycle Actions](#6-stage-4-customise-lifecycle-actions)
7. [Stage 5: Ongoing Use](#7-stage-5-ongoing-use)
8. [Cross-Platform Requirements](#8-cross-platform-requirements)
9. [What Exists Today vs What Needs Building](#9-what-exists-today-vs-what-needs-building)
10. [Relationship to Existing Roadmap Items](#10-relationship-to-existing-roadmap-items)
11. [Recommended Build Order](#11-recommended-build-order)
12. [Out of Scope](#12-out-of-scope)

---

## 1. End-to-End User Journey

The friend's experience, start to finish:

```
GET          → Download/build the app on Linux or Windows
LAUNCH       → First launch, no settings file exists → onboarding wizard starts
CONNECT      → Wizard Step 1: "Where is your OpenClaw instance?" → configure gateway
DISCOVER     → Wizard Step 2: "Where are your projects?" → configure scan paths
CUSTOMISE    → Wizard Step 3: "What tools do you have?" → configure lifecycle buttons
USE          → Land on the board, projects loaded, chat connected, buttons configured
```

**Mandatory steps:** Get, Launch, Connect (chat won't work without OpenClaw), Discover (board is empty without projects).
**Skippable steps:** Customise (lifecycle buttons can use sensible defaults or plain text prompts).

Each stage has a "what could go wrong" section — these are the failure modes we need to handle gracefully.

---

## 2. Stage 0: Get the App

### Current state
No distribution mechanism. The app is a local git repo with `bun tauri dev` for development and `npx tauri build --no-bundle` for release builds. Pierce builds from source on macOS.

### What's needed

**Option A: Source build (MVP for friend)**
- Friend clones the repo (private GitHub, collaborator invite)
- README with platform-specific build instructions (Rust toolchain, Node, Bun, Tauri prerequisites)
- `tauri build` produces platform-native binaries (`.deb`/`.AppImage` on Linux, `.msi`/`.exe` on Windows)
- No code signing initially — friend accepts unsigned binary

**Option B: Pre-built binaries (nicer)**
- GitHub Actions CI builds for macOS (arm64 + x64), Linux (x64), Windows (x64)
- Binaries attached to GitHub releases
- Friend downloads from Releases page

**Decision:** Option A (source build + good README). The friend is a developer — private GitHub repo with collaborator invite + accurate platform-specific build instructions is sufficient. CI-built binaries deferred to wider distribution.

### What could go wrong
- Missing prerequisites (Rust, Node, platform-specific libs like `libwebkit2gtk` on Linux)
- Build fails on Windows/Linux due to untested code paths
- README is Mac-centric

---

## 3. Stage 1: First Launch

### Current state
App creates a default settings file on first launch with Pierce-specific defaults:
- `openclawWorkspacePath: ~/clawdbot-sandbox`
- `scanPaths: [~/repos, ~/projects]` (if they exist)
- `updateMode: "source-rebuild"`
- No onboarding flow — user lands on an empty board with no guidance

### What's needed

**First-run detection:**
- Settings file doesn't exist → trigger onboarding wizard instead of creating defaults
- Settings file exists → normal launch (skip wizard)
- "Re-run setup" option accessible from settings (sidebar) for later changes

**Onboarding as full-screen takeover:**
- On first launch, the entire app window IS the onboarding — no board, no sidebar, no chrome behind it
- Full-screen stepper with progress indicator (Step 1 of 3, etc.)
- Themed consistently with the app (dark/light, brand colours, logo)
- Back/Next navigation between steps
- Cannot be skipped — setup is mandatory (OpenClaw connection + scan paths minimum)
- Settings file created at the end of onboarding with the user's choices
- Final step: "You're all set" → button click → CSS transition (opacity fade + slight scale) reveals the board with projects loaded
- "Re-run setup" accessible from settings for later changes

**Empty state (if no projects found after onboarding):**
- Board shows a friendly empty state with guidance: "No projects found. Add a folder in Settings or create a new project."
- Chat bar shows connection status (connected/disconnected)

### What could go wrong
- User exits wizard immediately — app should still launch, just with degraded state
- Settings file gets corrupted — need graceful recovery (delete + re-trigger wizard)

---

## 4. Stage 2: Connect to OpenClaw

### Current state
Rust backend reads `~/.openclaw/openclaw.json` for `gateway.port` and `gateway.auth.token`, then connects to `ws://127.0.0.1:{port}`. This only works when OpenClaw is installed locally on the same machine. Session key default is currently hardcoded to `agent:main:clawchestra` (post Deep Rename), but not yet user-configurable.

### What's needed

**Wizard step: "Where is OpenClaw running?"**

```
┌─────────────────────────────────────────────────┐
│  Where is your OpenClaw instance?               │
│                                                  │
│  ○ On this machine (local)                      │
│  ○ On a remote server (VPS / another machine)   │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Path A: Local**
- Auto-detect: try reading `~/.openclaw/openclaw.json` (or platform equivalent)
- If found: extract port + token, show "Found OpenClaw on port {port}" with a "Test Connection" button
- If not found: show instructions to install OpenClaw (`npm i -g openclaw`, then `openclaw setup`)
- Default WebSocket URL: `ws://127.0.0.1:{port}`

**Path B: Remote — sub-selection:**
```
┌─────────────────────────────────────────────────┐
│  How do you access your remote OpenClaw?        │
│                                                  │
│  ○ SSH tunnel (recommended for simplicity)      │
│  ○ Tailscale (private network)                  │
│  ○ Direct connection (I know the URL)           │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Path B1: SSH Tunnel**
- Show instructions: "Run this in your terminal:"
  ```
  ssh -N -L 18789:127.0.0.1:18789 user@your-vps
  ```
- Then configure as if local: `ws://127.0.0.1:18789`
- Ask for auth token: "Run `openclaw config get gateway.auth.token` on your VPS and paste it here"
- "Test Connection" button

**Path B2: Tailscale**
- Ask: "What's your Tailscale machine name or IP?"
- Input field for hostname/IP
- Auto-construct URL: **`wss://{input}:18789`** (default to `wss://`)
- Toggle: "Plain WebSocket (ws://)?" → switches to `ws://`, shows warning (see constraint below)
- Ask for auth token (same instruction as above)
- "Test Connection" button

**Path B3: Direct**
- Free-form URL input: "Gateway WebSocket URL"
- Placeholder: `wss://your-server:18789`
- Auth token input
- "Test Connection" button

> **⚠️ WebSocket loopback constraint (OpenClaw ≥ 2026.3.2):**
> Plain `ws://` connections are restricted to loopback addresses (`127.0.0.1`, `::1`) by default.
> Non-loopback `ws://` URLs (Tailscale IPs, direct remote IPs) will be rejected unless:
> 1. The connection uses `wss://` (TLS) — **recommended default for all remote paths**, or
> 2. OpenClaw is started with an env var opt-in (e.g. `OC_WS_ALLOW_REMOTE=1` — verify flag name in OpenClaw docs)
>
> **Impact on paths:**
> - **B1 (SSH Tunnel):** Unaffected — tunnel terminates at `127.0.0.1`, which is loopback.
> - **B2 (Tailscale):** Defaults to `wss://`. Plain `ws://` requires env var on the OpenClaw host.
> - **B3 (Direct):** Defaults to `wss://`. Same env var escape hatch applies.
>
> The onboarding wizard should warn when a user manually enters a `ws://` URL with a non-loopback host.

**All paths produce the same output:** `{ wsUrl, token, sessionKey }`

**Session key:**
- Auto-generate a sensible default: `agent:main:clawchestra` (not `pipeline-dashboard`)
- Advanced: let user override if they have a specific session key

**"Test Connection" button (all paths):**
- Attempts WebSocket connect + OpenClaw `connect` handshake
- Shows ✅ "Connected to OpenClaw v{version}" or ❌ "Connection failed: {reason}"
- Must succeed before proceeding (or user explicitly skips)

**Settings persistence:**
- Store `gatewayWsUrl`, `gatewayToken`, `gatewaySessionKey` in settings
- Rust backend reads from settings instead of (or in addition to) `~/.openclaw/openclaw.json`
- Settings UI (sidebar) allows changing these later

### Deployment topology: what the user should know

Where OpenClaw runs affects what it can do inside Clawchestra. The wizard should surface this clearly after a successful connection test:

- **Local OpenClaw** — full experience. OpenClaw can read project files, analyse codebases, work across projects at source-code depth. AI plans and AI execution live in the same loop: OpenClaw creates roadmap items and specs, the user (or a terminal agent) builds against them, OpenClaw sees the updated state and knows what's next.
- **Remote OpenClaw (VPS)** — app-aware assistant with project management, but no direct file access. OpenClaw still manages your roadmap, writes specs and plans, and guides workflows — Clawchestra pushes all project metadata into every conversation. Coding work runs through embedded terminal agents (Claude Code, Codex), which are always local. The planning loop still closes, it's just split: OpenClaw plans, terminals execute, the board updates.

This isn't a warning — both experiences are useful. But the user should understand the tradeoff so they can make an informed choice. For the full architectural analysis and future bridge solutions, see `docs/specs/vps-openclaw-file-access-spec.md`.

### What could go wrong
- User doesn't know their auth token → clear instructions on how to find it
- Connection fails silently → need visible error state with actionable message
- Token expires or changes → reconnection flow, "re-enter token" prompt
- WSS (TLS) requires different handling than WS — Tauri's WS client needs to support both

---

## 5. Stage 3: Discover Projects

### Current state
`scanPaths` defaults to `~/repos` + `~/projects` (if they exist on the local machine). Settings dialog has a scan paths editor. Projects are discovered by scanning for `PROJECT.md` files (or markdown files with appropriate frontmatter) in those paths.

### What's needed

**Wizard step: "Where are your projects?"**

```
┌─────────────────────────────────────────────────┐
│  Where do you keep your projects?               │
│                                                  │
│  Clawchestra looks for projects in folders you  │
│  specify. Each project needs a PROJECT.md file  │
│  with some metadata.                            │
│                                                  │
│  📁 ~/repos                           [Remove]  │
│  📁 ~/projects                        [Remove]  │
│                                                  │
│  [+ Add folder]                                 │
│                                                  │
│  Found: 3 projects in 2 folders                 │
│                                                  │
│  ℹ️ Don't have PROJECT.md files yet?             │
│  We'll help you create them in the next step.   │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Folder picker:**
- Uses existing `pick_folder` Tauri command
- Shows real-time scan results as folders are added ("Found: N projects")
- Platform-appropriate defaults: `~/repos`, `~/projects`, `~/code`, `~/dev` (scan for existence)

**Project scaffolding (post-wizard or on-demand):**
- "We found these git repos without PROJECT.md files:" → list of directories
- "Create PROJECT.md for:" → checkbox list → generates minimal frontmatter:
  ```yaml
  ---
  title: "{directory-name}"
  status: pending
  priority: 1
  type: project
  lastActivity: "{today}"
  ---
  ```
- This is programmatic, no AI needed
- Could also scaffold ROADMAP.md with empty `items: []`

**Schema documentation:**
- Within the wizard: brief explanation of what PROJECT.md is and why
- Link to full docs (or in-app help) for the complete schema
- The compliance block from AGENTS.md could be rendered as an in-app reference

### What could go wrong
- No projects found in any folder → show encouraging empty state, not error
- Projects found but no PROJECT.md → scaffolding flow (above)
- User has repos in non-standard locations → folder picker handles this
- Windows paths (`C:\Users\...`) vs Unix paths — needs cross-platform path handling

---

## 6. Stage 4: Customise Lifecycle Actions

### Current state
Five hardcoded lifecycle buttons on roadmap cards: Spec, Plan, Review, Deliver, Build. Prompts are generated by `deliverable-lifecycle.ts` with:
- **Review** hardcodes "Run `/plan_review` in Claude Code" and "Launch Claude Code via tmux"
- **Build** hardcodes "Run formal `/build` command / the `/build` skill"
- **Spec, Plan, Deliver** are generic enough to work with any AI assistant

Slash commands in chat are loaded by scanning local filesystem paths (`~/.claude/commands/`, `~/.config/opencode/skills/`, etc.).

### What's needed

**Tool detection (runs automatically, results shown in wizard):**

The app checks which tools are available on the user's system:

| Tool | Detection Method | What It Unlocks |
|------|-----------------|-----------------|
| Claude Code | `which claude` → exit 0 | `/plan_review`, `/build`, `/review` commands |
| Codex | `which codex` → exit 0 | Codex-specific workflows |
| Cursor | `which cursor` → exit 0 | Cursor integration |
| OpenCode | `which opencode` → exit 0 | OpenCode skills/commands |
| GitHub CLI | `which gh` → exit 0, then `gh auth status` | GitHub features (PR links, CI status) |
| Git | `which git` → exit 0 | Git status, fetch, sync |

Results displayed as a checklist:
```
┌─────────────────────────────────────────────────┐
│  Tools detected on your system:                 │
│                                                  │
│  ✅ Git 2.44.0                                  │
│  ✅ GitHub CLI (authenticated as @friend)       │
│  ❌ Claude Code — not found                     │
│  ❌ Codex — not found                           │
│  ✅ Cursor 0.45                                 │
│                                                  │
│  ℹ️ Some lifecycle actions use Claude Code       │
│  commands. Without it, those buttons will use    │
│  plain text prompts instead.                     │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Command discovery:**
- Scan known paths for available slash commands (already implemented in Tauri backend)
- Show what was found, grouped by source
- Let user decide which to keep/disable (future — not MVP)

**Configurable lifecycle buttons (part of this spec — subsumes Custom Card Actions):**

The 5 lifecycle buttons (Spec, Plan, Review, Deliver, Build) currently generate prompts that reference Claude Code-specific commands (`/plan_review`, `/build`). Without those tools, the Review and Build buttons produce broken prompts. The friend must be able to configure their own buttons before using the app.

**Design (per Pierce, 2026-02-19):**
- **0 to N buttons** — user adds buttons one-by-one. If none configured, no action bar shows on hover.
- **Max ~5-6 buttons** — constrained by card width.
- **Left-aligned** — button 1 always in slot 1, button 2 in slot 2, etc. Predictable positioning.
- **Per-button configuration:**
  - Icon (from lucide library picker)
  - Label (short name, e.g., "Build", "Review")
  - Prompt template with variables: `{project.title}`, `{item.title}`, `{item.specDoc}`, `{item.planDoc}`, etc.
  - Optional: slash command prefix
- **Configuration surface:** Sidebar settings panel (Phase 5 of this spec)
- **Tool detection informs suggestions:** "We found Claude Code — would you like to add a Build button with `/build`?" But the user decides.
- **If no buttons configured:** Action bar hidden. Cards behave as plain kanban cards.

**Replaces `deliverable-lifecycle.ts`:** The hardcoded prompt generation is removed entirely. Button definitions come from user settings. The existing 5 buttons become a "suggested preset" offered during onboarding Step 3 (tool detection) or in sidebar settings.

This subsumes the Custom Card Actions roadmap item — there's no interim adaptive step. The friend gets the configurable system from day one.

### What could go wrong
- `which` doesn't exist on Windows → use `where` instead, or check `PATH` directly
- Tool detection runs slow → do it async, show spinner, cache results
- User has tools in non-standard paths → "Add custom tool path" option (future)
- GitHub CLI installed but not authenticated → show warning, don't block

---

## 7. Stage 5: Ongoing Use

After onboarding, the user lands on the board with:
- Projects loaded from their scan paths
- Chat connected to their OpenClaw instance
- Lifecycle buttons adapted to their available tools

**Settings access:**
- All onboarding choices editable in Settings (sidebar panel or dialog)
- Grouped by the same categories: Connection, Projects, Tools
- "Re-run setup wizard" button for complete reconfiguration

**Ongoing needs already on the roadmap:**
- **Git Sync** — commit/push changes from the app (already specced, P1 up-next)
- **Roadmap Item Quick-Add** — add items via UI without editing YAML (pending)
- **Custom Card Actions** — full lifecycle button customisation (pending)

---

## 8. Cross-Platform Requirements

The friend is on Linux or Windows. The following macOS-specific code needs platform handling:

### Title bar
- **macOS:** `titleBarStyle: "Overlay"`, `trafficLightPosition`, 78px left padding for traffic lights
- **Linux/Windows:** Standard title bar OR custom title bar with close/minimize/maximize buttons on the right side
- **Detection:** Tauri provides `std::env::consts::OS` in Rust, `navigator.platform` or Tauri API in JS
- **Approach:** Conditional padding in TitleBar.tsx based on platform. Tauri config can be platform-specific.

### Paths
- **macOS/Linux:** `HOME` env var, `/` separators
- **Windows:** `USERPROFILE` env var (or `HOMEDRIVE` + `HOMEPATH`), `\` separators
- **Fix:** Use Rust `dirs` crate (`dirs::home_dir()`, `dirs::config_dir()`) instead of `env::var("HOME")`
- **Affects:** `default_scan_paths()`, `default_openclaw_workspace_path()`, `get_openclaw_gateway_config()`, `settings_file_path()`

### OpenClaw config location
- **macOS/Linux:** `~/.openclaw/openclaw.json`
- **Windows:** `%APPDATA%\openclaw\openclaw.json` (or wherever OpenClaw stores it on Windows)
- **Fix:** Use `dirs::config_dir()` / check OpenClaw docs for Windows path

### Shell commands
- **macOS/Linux:** `run_command_with_output` uses login shell (`zsh -l -c` / `bash -l -c`)
- **Windows:** Needs `cmd /c` or `powershell -Command` equivalent
- **Affects:** All `run_git`, `git_fetch`, tool detection commands

### Tauri config
- `tauri.conf.json` supports per-platform overrides for window configuration
- Traffic light position only applies to macOS
- Window decorations behaviour differs per platform

### Binary distribution
- **macOS:** `.app` bundle (already works)
- **Linux:** `.AppImage` or `.deb` (Tauri supports both)
- **Windows:** `.msi` or `.exe` (Tauri supports both via WiX/NSIS)
- No code signing for first friend (accept unsigned binary warnings)

### Update mechanism (source-rebuild)
The update button is core functionality — the friend will make code changes via chat (same workflow as Pierce). The rebuild flow must work cross-platform.

**Current state (macOS-only):**
- `run_app_update` has `#[cfg(not(target_os = "macos"))]` hard block returning error
- `.app` bundle path detection (macOS-specific)
- `/bin/sh ./update.sh` (works on macOS/Linux, not Windows)
- Fallback path: `/Applications/Clawchestra.app`

**What's needed:**
- Remove macOS-only gate in `run_app_update`
- Platform-aware binary location: `std::env::current_exe()` works on all platforms (no `.app` walk-up needed on Linux/Windows)
- Platform-aware rebuild script:
  - macOS/Linux: `update.sh` (exists, may need adjustments)
  - Windows: `update.bat` or `update.ps1` (new, same build steps)
- Both scripts: `npx tauri build --no-bundle` → copy binary to install location → restart
- Update check (`BUILD_COMMIT` vs `git HEAD`) already cross-platform — no changes needed
- Env vars: rename `PIPELINE_DASHBOARD_*` → `CLAWCHESTRA_*` (part of Deep Rename)

---

## 9. What Exists Today vs What Needs Building

| Capability | Current State | Needed | Effort |
|---|---|---|---|
| **Cross-platform build** | macOS only | Linux + Windows Tauri builds | Medium |
| **Title bar** | macOS traffic lights hardcoded | Platform-conditional padding | Small |
| **Path handling** | `env::var("HOME")` | `dirs` crate | Small |
| **Shell commands** | Unix login shell | Platform-conditional shell | Small-Medium |
| **First-run detection** | Creates default settings silently | Detect missing settings → wizard | Small |
| **Onboarding wizard UI** | Doesn't exist | Multi-step modal flow | Medium |
| **Gateway URL config** | Hardcoded localhost | Settings field + wizard step | Small |
| **Remote gateway support** | None | Wizard with SSH/Tailscale/Direct paths | Medium |
| **Connection test** | `openclaw_ping` exists | Wire into wizard UI with status feedback | Small |
| **Scan path management** | Settings dialog has it | Move to wizard + improve UX | Small |
| **Project scaffolding** | Doesn't exist | Generate PROJECT.md for bare repos | Small |
| **Tool detection** | Doesn't exist | `which`/`where` checks in Rust | Small |
| **Adaptive lifecycle prompts** | Hardcoded Claude Code references | Conditional based on detected tools | Small |
| **Full button customisation** | Doesn't exist | Icon picker, label, prompt editor | Large (separate item) |
| **Settings in sidebar** | Sidebar shell exists, no content | Settings panel as sidebar content | Medium |
| **Cross-platform update** | macOS-only (`#[cfg]` block, `.app` bundle path) | Remove gate, platform binary detection, Windows update script | Small-Medium |
| **tmux bundling** | Requires user to install tmux separately (`brew install tmux`). Terminal button disabled without it. | Bundle tmux binary inside `.app`/`.AppImage`/`.msi` (single static binary ~1.2MB). Use bundled path in `spawn()` so terminals work out of the box with no user-installed dependencies. | Small |
| **Session key config** | Hardcoded default `agent:main:clawchestra` | Make configurable, keep `agent:main:clawchestra` as sensible default | Small |
| **Deep rename** | Completed as prerequisite (`io.github.piercekearns.clawchestra`, renamed package/paths/session baseline) | No FFR implementation required; consume as baseline | - |

---

## 10. Relationship to Existing Roadmap Items

| Existing Item | Disposition |
|---|---|
| **Git Sync** (up-next, P1) | **Prerequisite** — deliver first. Useful to Pierce now, friend needs it for GitHub repos. |
| **Deep Rename** (up-next, P2) | **Prerequisite** — deliver second. Clean names before friend sees the app. |
| **Configurable OpenClaw Integration** (was pending) | **Removed from roadmap** — fully subsumed by Stage 2 of this spec. |
| **Sidebar Enhancements** (was up-next) | **Removed from roadmap** — settings panel becomes sidebar content as part of this work. |
| **Recently Completed Lifecycle** (was up-next) | **Removed from roadmap** — collapsed into this spec as future polish. Can be re-added later. |
| **Custom Card Actions** (was pending) | **Removed from roadmap** — fully subsumed by this spec (Stage 4 + Phase 5). |
| **App Customisation** (pending, P1) | **Deprioritised** — not blocking shareability |
| **Roadmap Item Quick-Add** (pending, P2) | **Deprioritised** — friend has AI, can add items via chat |

**Assumed baseline after prerequisites:**
- Tauri identifier is `io.github.piercekearns.clawchestra`
- Session key default is `agent:main:clawchestra`
- Internal package/path naming is `clawchestra` (no `pipeline-dashboard` runtime identifiers)

---

## 11. Recommended Build Order

Work is sequenced by the funnel: each stage unlocks the next.

### Phase 1: Cross-Platform Foundation
- Replace `env::var("HOME")` with `dirs` crate throughout `lib.rs`
- Platform-conditional shell execution in `run_command_with_output`
- Platform-conditional title bar padding in `TitleBar.tsx`
- Tauri config per-platform overrides (traffic light position only on macOS)
- Cross-platform update mechanism: remove macOS gate, platform-aware binary detection, `update.sh` (macOS/Linux) + `update.bat`/`update.ps1` (Windows)
- Verify `tauri build` produces working binaries on Linux and Windows
- Write/update build instructions in README

**Unlocks:** Friend can build, launch, and update the app on their OS.

### Phase 2: Gateway Connection Config
- Add `gatewayWsUrl`, `gatewayToken`, `gatewaySessionKey` to `DashboardSettings`
- Update `get_openclaw_gateway_config` to read from settings (with fallback to `~/.openclaw/openclaw.json`)
- Update `resolveTransport` to use settings values
- Add connection test command (returns version + status)
- Settings UI fields for gateway config (in existing Settings dialog initially)
- Keep default session key as `agent:main:clawchestra` while making it configurable

**Unlocks:** Friend can connect to their remote OpenClaw instance.

### Phase 3: Onboarding Wizard
- First-run detection (settings file missing → wizard)
- Wizard UI component (multi-step modal)
- Step 1: OpenClaw connection (local/remote flow with sub-paths)
- Step 2: Project discovery (scan paths + folder picker)
- Step 3: Tool detection (display only — adaptive prompts automatic)
- Settings file created from wizard choices
- "Re-run setup" button in settings

**Unlocks:** Friend has a guided first-run experience.

### Phase 4: Project Scaffolding
- Detect git repos without PROJECT.md in scan paths
- Offer to scaffold PROJECT.md + ROADMAP.md
- Tool detection results cached

**Unlocks:** Friend's existing repos appear in the app.

### Phase 5: Settings Sidebar Panel + Configurable Lifecycle Buttons
- Sidebar gets a Settings panel (first real sidebar content)
- Organised by category: Connection, Projects, Tools, Actions
- "Actions" section: add/remove lifecycle buttons (0-N, left-aligned, icon + label + prompt template)
- Suggested presets based on detected tools ("Add standard lifecycle actions?")
- Remove hardcoded `deliverable-lifecycle.ts` prompt generation — buttons come from settings
- If no buttons configured, no action bar on roadmap card hover
- Replaces or supplements the existing Settings dialog
- "Re-run setup wizard" button

**Unlocks:** Ongoing configuration accessible from the sidebar. Lifecycle buttons work with any toolchain.

---

## 12. Out of Scope

These are explicitly deferred to future roadmap items:

- **Multi-provider AI** (bring your own Anthropic/OpenAI keys directly) — requires chat infrastructure abstraction
- **Full lifecycle button customisation** (icon picker, prompt editor, add/remove buttons) — separate "Custom Card Actions" item
- **CRUD UI for roadmap items** (add/edit/delete via UI without AI) — nice-to-have, friend has OpenClaw
- **Code signing** — accept unsigned binaries for first friend
- **Auto-update mechanism** — friend rebuilds from source or downloads new release
- **GitHub OAuth in-app** — `gh` CLI auth is sufficient
- **Project auto-conformance** (AI agent reshapes existing projects) — friend uses scaffolding tool or manual setup
- **Mobile support** — desktop only
