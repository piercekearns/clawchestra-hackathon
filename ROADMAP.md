---
items:
  - id: chat-infrastructure
    title: Chat Infrastructure Overhaul
    status: in-progress
    priority: 1
    nextAction: 'Testing streaming fixes, multi-block message display, activity indicator'
    tags:
      - chat
      - infra
      - openclaw
      - architecture
    icon: "\U0001F527"
    specDoc: docs/specs/chat-infrastructure-phase-a-spec.md
  - id: github-api-403-errors
    title: Investigate GitHub API 403 Errors
    status: in-progress
    priority: 2
    nextAction: >-
      Diagnose recurring 403s on /commits endpoint from GitHubStatusBadge —
      likely rate limiting, may need auth token or caching
    tags:
      - bug
      - github
      - api
  - id: sidebar-enhancements
    title: Sidebar Enhancements
    status: up-next
    priority: 1
    nextAction: Define which panel(s) to build first
    tags:
      - ui
      - navigation
      - orchestration
    icon: "\U0001F5C2️"
  - id: recently-completed-lifecycle
    title: Recently Completed Lifecycle
    status: up-next
    priority: 2
    nextAction: Spec written — ready for plan/build
    tags:
      - roadmap
      - workflow
      - agents
      - changelog
    specDoc: docs/specs/recently-completed-lifecycle-spec.md
  - id: deep-rename-clawchestra
    title: Deep Rename to Clawchestra
    status: pending
    priority: 1
    nextAction: >-
      Surface rename done — deep rename needed for Cargo, data paths, session
      key, folder
    tags:
      - infra
      - rename
  - id: app-ux-review
    title: App UX Review & Improvements
    status: pending
    priority: 2
    nextAction: 'Hands-on review: what works, what doesn''t, what''s missing'
    tags:
      - ui
      - ux
      - roadmap
    icon: "\U0001F3A8"
  - id: roadmap-item-quick-add
    title: Roadmap Item Quick-Add
    status: pending
    priority: 3
    nextAction: >-
      Spec needed — define UI for manually adding roadmap items with
      schema-compliant defaults
    tags:
      - roadmap
      - ux
      - workflow
  - id: app-customisation
    title: App Customisation (Themes & Fonts)
    status: pending
    priority: 4
    nextAction: >-
      Spec needed — define font theme packages (Standard, Terminal, Geist) and
      colour theme system. Geist fonts available locally including Pixel
      variants.
    tags:
      - ui
      - ux
      - theming
    icon: "\U0001F3A8"
  - id: custom-card-actions
    title: Custom Card Actions (User-Defined Commands)
    status: pending
    priority: 5
    nextAction: >-
      Spec needed — define UI for users to configure custom action icons on
      roadmap cards with templated chat commands (project name, item name, doc
      paths auto-injected). Depends on collapsible-sidebar for settings surface.
    tags:
      - ui
      - ux
      - workflow
      - actions
    icon: ⚙️
  - id: openclaw-integration
    title: Configurable OpenClaw Integration
    status: pending
    priority: 6
    nextAction: Post-V2 scope
    tags:
      - integration
      - openclaw
  - id: collapsible-kanban-columns
    title: Collapsible Kanban Columns
    status: complete
    priority: 1
    nextAction: Code shipped — awaiting verification
    tags:
      - ui
      - kanban
      - ux
    specDoc: docs/specs/collapsible-kanban-columns-spec.md
  - id: project-card-opens-kanban
    title: Project Card Opens Kanban Directly
    status: complete
    priority: 2
    nextAction: Verified and shipped
    tags:
      - ui
      - ux
      - navigation
    specDoc: docs/specs/project-card-opens-kanban-spec.md
  - id: draggable-kanban-columns
    title: Draggable Kanban Columns
    status: complete
    priority: 3
    nextAction: Code shipped — awaiting verification
    tags:
      - ui
      - kanban
      - ux
    specDoc: docs/specs/draggable-kanban-columns-spec.md
  - id: collapsible-sidebar
    title: Collapsible Sidebar
    status: complete
    priority: 4
    nextAction: Built — needs manual testing
    tags:
      - ui
    icon: "\U0001F4D0"
    specDoc: docs/specs/collapsible-sidebar-spec.md
    planDoc: docs/plans/collapsible-sidebar-plan.md
  - id: deliverable-lifecycle-orchestration
    title: Deliverable Lifecycle Orchestration
    status: complete
    priority: 5
    nextAction: Code shipped - awaiting verification
    tags:
      - roadmap
      - workflow
      - ux
      - automation
    specDoc: docs/specs/deliverable-lifecycle-orchestration-spec.md
    planDoc: docs/plans/deliverable-lifecycle-orchestration-plan.md
---

# Clawchestra — Roadmap

Individual roadmap item docs live in `roadmap/` folder. Spec/plan docs in `docs/specs/` and `docs/plans/`.
