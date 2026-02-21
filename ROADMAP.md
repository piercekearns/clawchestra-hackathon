---
items:
  - id: git-branch-sync
    title: 'Git Sync: Branch Management (Phase 3)'
    status: in-progress
    priority: 1
    nextAction: >-
      Plan written — implement branch selection + cherry-pick orchestration + AI
      conflict handling, including explicit no-remote `(local)` branch behavior.
      Depends on git-sync-scope completion.
    tags:
      - git
      - sync
      - branches
      - ai-agent
    icon: "\U0001F33F"
    specDoc: docs/specs/git-branch-sync-spec.md
  - id: chat-infrastructure
    title: 'Chat Reliability: Persistent Bugs'
    status: in-progress
    priority: 2
    nextAction: >-
      Force-update path now allowed during active turns (with warning) and
      tracker includes reconnect/resume aspiration; continue Phase 2 bug intake
      during daily chat usage, then run holistic review/fix pass on new issues.
    tags:
      - chat
      - bugs
      - reliability
    icon: "\U0001F41B"
    specDoc: docs/specs/chat-infrastructure-phase-a-spec.md
    planDoc: docs/plans/chat-infrastructure-persistent-bugs-plan.md
  - id: architecture-direction
    title: Architecture Direction
    status: up-next
    priority: 1
    nextAction: >-
      Full implementation plan written (9 phases, 7 critical design decisions,
      concrete state.json schema). Ready for /deepen-plan then /build execution.
    tags:
      - architecture
      - openclaw
      - sync
      - multi-platform
    icon: "\U0001F3D7️"
    specDoc: docs/specs/architecture-direction-spec.md
    planDoc: docs/plans/architecture-direction-plan.md
  - id: first-friend-readiness
    title: First Friend Readiness
    status: up-next
    priority: 2
    nextAction: >-
      Spec exists — needs revision against finalized architecture-direction spec
      (PROJECT.md → CLAWCHESTRA.md references, branch injection in onboarding
      Stage 3, state.json in project discovery). Cross-platform foundation
      (Phase 1) can start NOW in parallel with architecture direction.
      Onboarding wizard (Phase 3) blocked on architecture Phase 1.
    tags:
      - onboarding
      - cross-platform
      - openclaw
      - ux
    icon: "\U0001F91D"
    specDoc: docs/specs/first-friend-readiness-spec.md
  - id: clawchestra-ai-website
    title: Launch Clawchestra.ai Website
    status: up-next
    priority: 3
    nextAction: >-
      Discovery brief written — run Variant Exploration Phase (3 polished static
      mockups under locked brand/copy constraints), choose one direction, then
      write implementation plan before production build (private-alpha + public
      waitlist launch posture).
    tags:
      - website
      - marketing
      - frontend-design
      - distribution
      - openclaw
    icon: "\U0001F310"
    specDoc: docs/specs/clawchestra-ai-website-spec.md
  - id: roadmap-item-quick-add
    title: Roadmap Item Quick-Add (AI Chat-First)
    status: pending
    priority: 1
    nextAction: >-
      Spec written — reimagined as the first distributed AI surface. Primary
      creation method: AI chat box embedded in the new card UI where users
      describe what they want in natural language and OpenClaw structures it
      into a schema-compliant roadmap item. Optional manual input fields exposed
      for users who prefer direct editing. First proof-of-concept for the
      distributed AI surfaces pattern. Depends on architecture-direction
      completion.
    tags:
      - roadmap
      - ux
      - workflow
      - ai-surfaces
    icon: ➕
    specDoc: docs/specs/roadmap-item-quick-add-spec.md
  - id: ai-commit-messages
    title: AI-Generated Commit Messages
    status: pending
    priority: 2
    nextAction: >-
      Spec written — needs model routing decision (which model for cheap AI
      calls) and implementation. Depends on rate-limit-resilience for smart
      model routing.
    tags:
      - git
      - ai
      - ux
    icon: ✨
    specDoc: docs/specs/ai-commit-messages-spec.md
  - id: rate-limit-resilience
    title: Rate Limit Resilience & Provider Failover
    status: pending
    priority: 3
    nextAction: >-
      Exploratory spec written — needs research phase to validate OpenClaw
      failover behaviour (bug #19249), event stream signals, and auth profile
      detection. Then plan Layer 1 (detection/display), Layer 2 (failover
      guidance), Layer 3 (smart model routing).
    tags:
      - chat
      - resilience
      - failover
      - onboarding
    icon: "\U0001F6E1️"
    specDoc: docs/specs/rate-limit-resilience-spec.md
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
  - id: distributed-ai-surfaces
    title: Distributed AI Surfaces
    status: pending
    priority: 5
    nextAction: >-
      Spec needed — architectural redesign to support context-aware AI chat
      components embedded throughout the app, replacing the single chat drawer
      as the sole interaction point. Each surface auto-injects context based on
      its UI location (git sync dialog, roadmap item form, project card, etc.)
      so the user never has to state what they're working on — the UI location
      IS the instruction. Depends on architecture-direction completion.
      Roadmap-item-quick-add serves as P3 proof-of-concept for this pattern.
      Spec must account for app-layer redesign sufficient to absorb this class
      of feature, not bolt-on additions.
    tags:
      - architecture
      - ai
      - ux
      - chat
      - openclaw
    icon: "\U0001F4AC"
    specDoc: docs/specs/distributed-ai-surfaces-spec.md
  - id: project-conversation-hub
    title: Project Conversation Hub
    status: pending
    priority: 6
    nextAction: >-
      Spec needed — Conductor/Codex-inspired threaded conversation management
      organized by project. Projects become conversation containers with
      multiple concurrent sub-conversations (per roadmap item, general
      project-level, etc.). Conversations accessible directly from project cards
      and roadmap item cards via visual indicators — click a card to surface its
      active threads and open the sidebar to that conversation, or create a new
      thread from that location. No hierarchy navigation needed. History
      persisted per-project, per-item. Depends on distributed-ai-surfaces for
      the multi-surface foundation.
    tags:
      - chat
      - projects
      - ux
      - threads
      - navigation
    icon: "\U0001F5C2️"
    specDoc: docs/specs/project-conversation-hub-spec.md
  - id: embedded-agent-terminals
    title: Embedded Agent Terminals
    status: pending
    priority: 7
    nextAction: >-
      Comprehensive spec written — Model D (Parallel Tracks) chosen. Three-phase
      progression: (1) Embedded terminals via tauri-plugin-pty + xterm.js —
      direct agent access tied to projects/items, Conductor- style multiplexing.
      (2) Enhanced session management — dashboard, status indicators,
      notifications, output parsing, named sessions, scrollback persistence. (3)
      Optional protocol integration (ACP/ JSON-RPC) for native UI when agents
      support it, terminal stays as option. Non-destructive: OpenClaw retains
      all capabilities, direct agent sessions are a parallel lane. Landscape
      research covers Conductor, Codex, OpenCode, Kilo Code, ACP. Phase 1 needs
      spike: xterm.js + Tauri v2 performance validation. Depends on
      project-conversation-hub for the container model.
    tags:
      - agents
      - terminals
      - claude-code
      - codex
      - projects
    icon: "\U0001F4BB"
    specDoc: docs/specs/embedded-agent-terminals-spec.md
  - id: clawchestra-apps
    title: Clawchestra Apps (Mobile & Web)
    status: pending
    priority: 8
    nextAction: >-
      Blue sky — spec needed once architecture direction + FFR are complete.
      Covers: iOS app (first), Android app, web app, "Login with OpenClaw"
      cross-platform identity standard, cross-device sync UX.
    tags:
      - mobile
      - web
      - cross-platform
      - openclaw
      - future-scope
    icon: "\U0001F4F1"
  - id: deep-rename-clawchestra
    title: Deep Rename to Clawchestra
    status: complete
    priority: 1
    nextAction: Built — awaiting verification
    tags:
      - infra
      - rename
    specDoc: docs/specs/deep-rename-clawchestra-spec.md
    planDoc: docs/plans/deep-rename-clawchestra-plan.md
  - id: git-sync
    title: Git Sync (Phase 1)
    status: complete
    priority: 2
    nextAction: Verified — commit + push working. Phase 2+3 roadmap items created.
    tags:
      - git
      - github
      - sync
      - workflow
    icon: "\U0001F504"
    specDoc: docs/specs/git-sync-spec.md
    planDoc: docs/plans/git-sync-plan.md
  - id: github-api-403-errors
    title: 'Local Git Intelligence (was: GitHub API 403 Errors)'
    status: complete
    priority: 3
    nextAction: Built — needs manual testing (rebuild app to verify)
    tags:
      - bug
      - github
      - git
      - enhancement
    specDoc: docs/specs/github-api-403-errors-spec.md
    planDoc: docs/plans/github-api-403-errors-plan.md
  - id: collapsible-kanban-columns
    title: Collapsible Kanban Columns
    status: complete
    priority: 4
    nextAction: Code shipped — awaiting verification
    tags:
      - ui
      - kanban
      - ux
    specDoc: docs/specs/collapsible-kanban-columns-spec.md
  - id: project-card-opens-kanban
    title: Project Card Opens Kanban Directly
    status: complete
    priority: 5
    nextAction: Verified and shipped
    tags:
      - ui
      - ux
      - navigation
    specDoc: docs/specs/project-card-opens-kanban-spec.md
  - id: draggable-kanban-columns
    title: Draggable Kanban Columns
    status: complete
    priority: 6
    nextAction: Code shipped — awaiting verification
    tags:
      - ui
      - kanban
      - ux
    specDoc: docs/specs/draggable-kanban-columns-spec.md
  - id: collapsible-sidebar
    title: Collapsible Sidebar
    status: complete
    priority: 7
    nextAction: Built — needs manual testing
    tags:
      - ui
    icon: "\U0001F4D0"
    specDoc: docs/specs/collapsible-sidebar-spec.md
    planDoc: docs/plans/collapsible-sidebar-plan.md
  - id: deliverable-lifecycle-orchestration
    title: Deliverable Lifecycle Orchestration
    status: complete
    priority: 8
    nextAction: Code shipped - awaiting verification
    tags:
      - roadmap
      - workflow
      - ux
      - automation
    specDoc: docs/specs/deliverable-lifecycle-orchestration-spec.md
    planDoc: docs/plans/deliverable-lifecycle-orchestration-plan.md
  - id: app-ux-review
    title: App UX Review & Improvements
    status: complete
    priority: 9
    nextAction: 'Hands-on review: what works, what doesn''t, what''s missing'
    tags:
      - ui
      - ux
      - roadmap
    icon: "\U0001F3A8"
  - id: git-sync-scope
    title: 'Git Sync: Scope Expansion (Phase 2)'
    status: complete
    priority: 10
    nextAction: >-
      Code shipped (f4cda66) — awaiting manual verification. Test: open Sync
      dialog, verify 3-category grouping (Metadata/Documents/Code), Code
      unchecked by default, commit with mixed categories.
    tags:
      - git
      - sync
      - workflow
    icon: "\U0001F504"
    specDoc: docs/specs/git-sync-scope-spec.md
---

# Clawchestra — Roadmap

Individual roadmap item docs live in `roadmap/` folder. Spec/plan docs in `docs/specs/` and `docs/plans/`.
