---
items:
  - id: project-modal-improvements
    title: Project Modal Improvements
    status: in-progress
    priority: 1
    nextAction: Test all 6 phases, verify build
    tags: [ui, ux, core]
    icon: "\U0001F3A8"
  - id: project-architecture-overhaul
    title: "Project Architecture Overhaul"
    status: pending
    priority: 2
    nextAction: "Claude Code: /plan then /build against docs/specs/project-architecture-overhaul-spec.md"
    tags: [architecture, data, cleanup, core]
    icon: "\U0001F3D7"
    specDoc: docs/specs/project-architecture-overhaul-spec.md
  - id: collapsible-sidebar
    title: Collapsible Sidebar
    status: pending
    priority: 3
    nextAction: Spec needed
    tags: [ui]
  - id: deliverable-priority-view
    title: Deliverable Priority View
    status: pending
    priority: 4
    nextAction: Spec needed
    tags: [ui, roadmap]
  - id: openclaw-integration
    title: Configurable OpenClaw Integration
    status: pending
    priority: 5
    nextAction: Post-V2 scope
    tags: [integration, openclaw]
  - id: websocket-reconnection
    title: WebSocket Auto-Reconnection
    status: pending
    priority: 6
    nextAction: Debug TauriOpenClawConnection reconnect logic
    tags: [infra, chat]
  - id: openclaw-platform-interaction-audit
    title: "OpenClaw Platform Interaction Audit"
    status: complete
    priority: 7
    nextAction: "Done — output at clawdbot-sandbox/projects/openclaw-platform-audit.md"
    tags: [research, openclaw, clawos]
    icon: "\U0001F50D"
  - id: scoped-chat-sessions
    title: "Scoped Chat Sessions"
    status: pending
    priority: 8
    nextAction: "Phase 2: Change session key in lib.rs + clear chat.db"
    tags: [architecture, openclaw, chat]
    icon: "\U0001F9F5"
    specDoc: docs/specs/scoped-chat-sessions-spec.md
---

# Pipeline Dashboard — Roadmap

Individual roadmap item docs live in `roadmap/` folder. Spec/plan docs in `docs/specs/` and `docs/plans/`.
