# Clawchestra

***Claws* the loop.** Plan, see, deploy, ship - **one surface.**

Clawchestra is a native desktop app that closes the gap between planning and building. Every project, roadmap item, spec, and agent session lives in one workspace - and OpenClaw keeps it all in sync across devices.

**Website:** [clawchestra.ai](https://clawchestra.ai)

---

## What it does

Most project tools track work. Most agent tools run agents. Clawchestra puts both in the same surface so they stay in step:

- **Visual project management** - Kanban board with columns, cards, priorities, drag-and-drop reordering. Create projects, break them into roadmap items, write specs and plans.
- **Embedded AI chat** - OpenClaw conversations scoped to your project context. Describe what you need in natural language - it creates roadmap items, writes specs, moves cards, and kicks off work.
- **Embedded agent terminals** - Launch Claude Code, Codex, or any CLI agent in managed terminal sessions, pre-scoped to the roadmap item you're working on.
- **Real-time sync** - As agents build, the board updates. As you reorganise the board, agents see the changes. Planning and execution are **never** out of step.
- **Multi-device** - OpenClaw syncs your board, specs, and agents across every device. **Any** agent, **any** project, from **anywhere.**

---

## Architecture

| Layer | Tech |
|-------|------|
| Desktop shell | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React + TypeScript + Tailwind CSS |
| Terminal | xterm.js with tmux-backed persistent sessions |
| AI | OpenClaw (local or remote) with multi-provider routing |
| State | JSON-based project state with file-system watcher + atomic writes |

---

## Powered by OpenClaw

OpenClaw isn't a plugin or an integration - it lives inside the app. Clawchestra uses OpenClaw in three distinct ways:

### 1. AI agent across every surface

OpenClaw is embedded directly into the Kanban board, roadmap item creation, and project workspaces. It's not a single chat window you switch to - it's woven into every surface:

- **Board** - ask OpenClaw to create items, reorganise priorities, or move cards between columns, right from the board itself.
- **Roadmap item creation** - describe what you need in natural language and OpenClaw generates the item, writes the spec, and places it on the board.
- **Workspace chats** - scoped conversations tied to specific projects or roadmap items, with full context about what you're working on.
- **Agent terminals** - launch Claude Code, Codex, or any CLI agent in managed terminal sessions, pre-scoped to the roadmap item you're building.

### 2. Context-aware - it knows the app

Clawchestra injects its own capability map (`CAPABILITIES.md`) into OpenClaw at runtime. This means your OpenClaw instance understands Clawchestra's features, views, and workflows - it can guide you through the app because it knows how the app works. From the first conversation, OpenClaw acts as your personal Claw guide.

### 3. Personal cloud sync

All project state - roadmap items, specs, plans, priorities - lives as plain JSON files (`.clawchestra/state.json` per project) that OpenClaw syncs across every device you're signed into. OpenClaw becomes your personal cloud:

- **Every agent can read and write it** - Claude Code, Codex, or any tool that can read JSON has full access to your roadmap.
- **Every project gets it for free** - drop a `.clawchestra/` directory into any repo and it's a Clawchestra project.
- **Every device stays in sync** - edit on your laptop, see it on your desktop. An agent on a VPS pushes changes that appear on your board instantly.

No database, no proprietary API, no vendor lock-in. Your project state is portable, version-controllable, and readable by humans and machines alike.

---

## Project structure

```
src/                    React frontend
  components/           UI components (kanban, chat, terminals, sidebar, settings)
  hooks/                Custom React hooks
  lib/                  State management, schema, utilities
src-tauri/              Tauri backend (Rust)
  src/lib.rs            IPC commands, file system, git, terminal management
website/                clawchestra.ai marketing site
assets/                 Brand assets and icons
```

---

## Build from source

**Prerequisites:** Node.js 18+, pnpm, Rust toolchain, platform-specific Tauri dependencies ([see Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

```bash
# Install dependencies
pnpm install

# Development
pnpm dev              # Frontend dev server
pnpm tauri dev        # Full app with hot reload

# Production build
pnpm build            # Frontend only
pnpm tauri build      # Full native app bundle
```

### Platform artifacts

| OS | Artifact | Notes |
|----|----------|-------|
| macOS | `.dmg` | Unsigned alpha - requires right-click → Open on first launch |
| Windows | `.msi` | Standard installer |
| Linux | `.AppImage`, `.deb` | Portable and Debian package |

---

## Status

Clawchestra is in **private alpha**. The current focus is on:

- Cross-platform install hardening
- OpenClaw local and remote sync
- Multi-device state synchronisation
- Terminal session persistence and agent detection

---

## License

This repository is **source-visible** for evaluation and hackathon judging purposes.

All rights are reserved. You may not copy, modify, redistribute, or create derivative works from this code except as allowed by law or by explicit written permission.

---

## Contact

For access, demos, or questions - reach out to [@piercekearns](https://github.com/piercekearns).
