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

**Recommendation:** Start with Option A (source build + good README). Add CI later. The friend is technical enough to build from source.

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

**Onboarding wizard:**
- Modal or full-screen flow, step-by-step
- Progress indicator (Step 1 of 3, etc.)
- Back/Next navigation
- Can be exited early but warns "some features won't work until setup is complete"
- Settings file created at the end of onboarding with the user's choices

**Empty state (if wizard skipped or partially completed):**
- Board shows a friendly empty state, not just blank space
- "Get started" card or banner linking back to setup
- Chat bar shows "Not connected — configure OpenClaw in settings" if gateway not configured

### What could go wrong
- User exits wizard immediately — app should still launch, just with degraded state
- Settings file gets corrupted — need graceful recovery (delete + re-trigger wizard)

---

## 4. Stage 2: Connect to OpenClaw

### Current state
Rust backend reads `~/.openclaw/openclaw.json` for `gateway.port` and `gateway.auth.token`, then connects to `ws://127.0.0.1:{port}`. This only works when OpenClaw is installed locally on the same machine. Session key is hardcoded to `agent:main:pipeline-dashboard`.

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
- Auto-construct URL: `ws://{input}:18789` (or `wss://{input}` if using Serve)
- Toggle: "Using Tailscale Serve (HTTPS)?" → switches to `wss://`
- Ask for auth token (same instruction as above)
- "Test Connection" button

**Path B3: Direct**
- Free-form URL input: "Gateway WebSocket URL"
- Placeholder: `ws://your-server:18789`
- Auth token input
- "Test Connection" button

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
  status: simmering
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

**Lifecycle button configuration (skippable for MVP):**

For the first friend milestone, the lifecycle buttons can remain as 5 fixed buttons but with **adaptive prompts**:

- If Claude Code detected → current prompts (reference `/plan_review`, `/build`)
- If Claude Code NOT detected → generic prompts that work with any AI:
  - Review: "Review this plan for completeness, feasibility, and potential issues: {planDoc}"
  - Build: "Implement this roadmap item following the spec and plan: {specDoc}, {planDoc}"
  - (Spec, Plan, Deliver are already generic enough)

**Full button customisation (future — separate roadmap item):**
- User-defined buttons: icon (lucide picker), label, prompt template
- Prompt template variables: `{project.title}`, `{item.title}`, `{item.specDoc}`, `{item.planDoc}`, etc.
- Per-button "slash command prefix" option (e.g., prepend `/build` before the prompt)
- Add/remove/reorder buttons
- This is the existing "Custom Card Actions" roadmap item — it stays separate

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
| **Session key config** | Hardcoded `agent:main:pipeline-dashboard` | Configurable, sensible default | Small |
| **Deep rename** | Package still called `pipeline-dashboard` | Rename Cargo, paths, session key | Medium |

---

## 10. Relationship to Existing Roadmap Items

| Existing Item | Disposition |
|---|---|
| **Configurable OpenClaw Integration** (pending, P1) | **Subsumed** — Stage 2 of this spec covers it fully |
| **Custom Card Actions** (pending, P4) | **Kept separate** — full button customisation is future work. This spec handles adaptive prompts as interim. |
| **Git Sync** (up-next, P1) | **Independent, stays high priority** — useful to Pierce now, friend needs it for GitHub repos |
| **Deep Rename** (up-next, P2) | **Dependency** — should happen before or during this work (session key, package name) |
| **Sidebar Enhancements** (up-next, P4) | **Partially subsumed** — settings panel becomes sidebar content as part of this work. Other sidebar panels remain separate. |
| **App Customisation** (pending, P2) | **Deprioritised** — not blocking shareability |
| **Roadmap Item Quick-Add** (pending, P3) | **Deprioritised** — friend has AI, can add items via chat |
| **Recently Completed Lifecycle** (up-next, P3) | **Deprioritised** — polish, not blocking |

---

## 11. Recommended Build Order

Work is sequenced by the funnel: each stage unlocks the next.

### Phase 1: Cross-Platform Foundation
- Replace `env::var("HOME")` with `dirs` crate throughout `lib.rs`
- Platform-conditional shell execution in `run_command_with_output`
- Platform-conditional title bar padding in `TitleBar.tsx`
- Tauri config per-platform overrides (traffic light position only on macOS)
- Verify `tauri build` produces working binaries on Linux and Windows
- Write/update build instructions in README

**Unlocks:** Friend can build and launch the app on their OS.

### Phase 2: Gateway Connection Config
- Add `gatewayWsUrl`, `gatewayToken`, `gatewaySessionKey` to `DashboardSettings`
- Update `get_openclaw_gateway_config` to read from settings (with fallback to `~/.openclaw/openclaw.json`)
- Update `resolveTransport` to use settings values
- Add connection test command (returns version + status)
- Settings UI fields for gateway config (in existing Settings dialog initially)
- Change default session key from `agent:main:pipeline-dashboard` to `agent:main:clawchestra`

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

### Phase 4: Project Scaffolding + Adaptive Prompts
- Detect git repos without PROJECT.md in scan paths
- Offer to scaffold PROJECT.md + ROADMAP.md
- Lifecycle prompts adapt based on detected tools (Claude Code present → current prompts, absent → generic)
- Tool detection results cached and shown in settings

**Unlocks:** Friend's existing repos appear in the app. Lifecycle buttons work regardless of toolchain.

### Phase 5: Settings Sidebar Panel
- Sidebar gets a Settings panel (first real sidebar content)
- Organised by category: Connection, Projects, Tools
- Replaces or supplements the existing Settings dialog
- "Re-run setup wizard" button

**Unlocks:** Ongoing configuration accessible from the sidebar.

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
