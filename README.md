# Clawchestra

***Claws* the loop.** Plan, see, deploy, ship — **one surface.**

Clawchestra is a native desktop app that closes the gap between planning and building. Every project, roadmap item, spec, and agent session lives in one workspace — and OpenClaw keeps it all in sync across devices.

**Website:** [clawchestra.ai](https://clawchestra.ai)

---

## What it does

Most project tools track work. Most agent tools run agents. Clawchestra puts both in the same surface so they stay in step:

- **Visual project management** — Kanban board with columns, cards, priorities, drag-and-drop reordering. Create projects, break them into roadmap items, write specs and plans.
- **Embedded AI chat** — OpenClaw conversations scoped to your project context. Describe what you need in natural language — it creates roadmap items, writes specs, moves cards, and kicks off work.
- **Embedded agent terminals** — Launch Claude Code, Codex, or any CLI agent in managed terminal sessions, pre-scoped to the roadmap item you're working on.
- **Real-time sync** — As agents build, the board updates. As you reorganise the board, agents see the changes. Planning and execution are **never** out of step.
- **Multi-device** — OpenClaw syncs your board, specs, and agents across every device. **Any** agent, **any** project, from **anywhere.**

---

## Architecture

| Layer | Tech |
|-------|------|
| Desktop shell | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React + TypeScript + Tailwind CSS |
| Terminal | xterm.js with tmux-backed persistent sessions |
| AI | OpenClaw (local or remote) with multi-provider routing |
| State | JSON-based project state with file-system watcher + atomic writes |

### Agent-native by design

Clawchestra is built around the idea that AI isn't a sidebar — it's a first-class participant. Every feature has both a UI surface and an AI surface:

- Cards can be created by clicking "Add" or by telling OpenClaw what you need
- Items can be moved by dragging or by asking OpenClaw to reorganise
- Specs can be written in the editor or generated from a chat conversation
- Terminals can be launched from the board or opened by OpenClaw to start work

The AI sees the same state the user sees, and can act on it.

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
| macOS | `.dmg` | Unsigned alpha — requires right-click → Open on first launch |
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

For access, demos, or questions — reach out to [@piercekearns](https://github.com/piercekearns).
