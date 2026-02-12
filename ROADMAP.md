---
title: Pipeline Dashboard Roadmap
---

# Pipeline Dashboard — Roadmap

This file is an index. Individual roadmap items live as separate `.md` files in the `roadmap/` folder.

Each item is a `type: deliverable` with `parent: pipeline-dashboard` and can be rendered as a card in the Dashboard's Level 2 view.

---

## Up Next

| Priority | Item | Spec |
|----------|------|------|
| 1 | [Project Modal Improvements](roadmap/project-modal-improvements.md) | Needs scoping |
| 2 | [Collapsible Sidebar](roadmap/collapsible-sidebar.md) | — |
| 3 | [Deliverable Priority View](roadmap/deliverable-priority-view.md) | — |
| 4 | [Retrofit Projects to Schema](roadmap/retrofit-projects-to-schema.md) | — |
| 5 | [Configurable OpenClaw Integration](roadmap/openclaw-integration-config.md) | Post-V2 |
| 6 | [WebSocket Auto-Reconnection](roadmap/websocket-reconnection.md) | — |

## In-Flight

| Priority | Item | Spec |
|----------|------|------|
| — | — | — |

## Shipped (2026-02-12)

| Item | Spec |
|------|------|
| [Cmd+K Search](roadmap/cmd-k-search.md) | [PLAN](docs/plans/2026-02-12-feat-cmd-k-search-plan.md) |
| [Chat Persistence](roadmap/chat-persistence.md) | [SPEC](docs/chat-persistence/SPEC.md) |
| [Chat UX Overhaul (MVP)](roadmap/chat-ux-overhaul.md) | [PLAN](docs/plans/2026-02-12-feat-chat-ux-overhaul-plan.md) |
| [Chat Drawer UI](roadmap/chat-drawer-ui.md) | [SPEC](docs/CHAT-DRAWER-SPEC.md) |
| [Improve Markdown Rendering](roadmap/improve-markdown-rendering.md) | — |
| [Architecture V2 (MVP)](roadmap/architecture-v2.md) | [SPEC](docs/ARCHITECTURE-V2-SPEC.md) |
| [Architecture V2.1 Hardening](roadmap/architecture-v2-1-hardening.md) | [SPEC](docs/ARCHITECTURE-V2-SPEC.md) |

---

## Notes

- Completed items move to `CHANGELOG.md`
- Each deliverable file has frontmatter with `parent: pipeline-dashboard`
- Deliverables can have `specDoc` and `planDoc` fields linking to documentation
- This index is for human reference; the Dashboard reads from individual files
