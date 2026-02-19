---
items:
  - id: git-sync-scope
    title: 'Git Sync: Scope Expansion (Phase 2)'
    status: in-progress
    priority: 1
    nextAction: >-
      Plan written — implement Phase 2 all-file dirty detection and
      Metadata/Documents/Code grouping with local-only Kanban auto-commit
      boundaries preserved.
    tags:
      - git
      - sync
      - workflow
    icon: "\U0001F504"
    specDoc: docs/specs/git-sync-scope-spec.md
  - id: chat-infrastructure
    title: 'Chat Reliability: Persistent Bugs'
    status: in-progress
    priority: 2
    nextAction: >-
      Reliability fixes built and validated by tests/build; use this item as
      ongoing Phase 2 bug intake during daily chat usage, then run holistic
      review/fix pass on newly logged issues.
    tags:
      - chat
      - bugs
      - reliability
    icon: "\U0001F41B"
    specDoc: docs/specs/chat-infrastructure-phase-a-spec.md
    planDoc: docs/plans/chat-infrastructure-persistent-bugs-plan.md
  - id: git-branch-sync
    title: 'Git Sync: Branch Management (Phase 3)'
    status: up-next
    priority: 1
    nextAction: >-
      Plan written — implement branch selection + cherry-pick orchestration +
      AI conflict handling, including explicit no-remote `(local)` branch
      behavior. Depends on git-sync-scope completion.
    tags:
      - git
      - sync
      - branches
      - ai-agent
    icon: "\U0001F33F"
    specDoc: docs/specs/git-branch-sync-spec.md
  - id: deep-rename-clawchestra
    title: Deep Rename to Clawchestra
    status: up-next
    priority: 2
    nextAction: Plan written — ready for build execution
    tags:
      - infra
      - rename
    specDoc: docs/specs/deep-rename-clawchestra-spec.md
  - id: first-friend-readiness
    title: First Friend Readiness
    status: up-next
    priority: 3
    nextAction: Plan written — ready for phased build execution
    tags:
      - onboarding
      - cross-platform
      - openclaw
      - ux
    icon: "\U0001F91D"
    specDoc: docs/specs/first-friend-readiness-spec.md
  - id: app-customisation
    title: App Customisation (Themes & Fonts)
    status: pending
    priority: 1
    nextAction: >-
      Spec needed — define font theme packages (Standard, Terminal, Geist) and
      colour theme system. Geist fonts available locally including Pixel
      variants.
    tags:
      - ui
      - ux
      - theming
    icon: "\U0001F3A8"
  - id: roadmap-item-quick-add
    title: Roadmap Item Quick-Add
    status: pending
    priority: 2
    nextAction: >-
      Spec needed — define UI for manually adding roadmap items with
      schema-compliant defaults
    tags:
      - roadmap
      - ux
      - workflow
  - id: clawchestra-ai-website
    title: Launch Clawchestra.ai Website
    status: pending
    priority: 3
    nextAction: >-
      Spec written — run openclaw.ai/clawi.ai design-stack reconnaissance, then
      resolve distribution/GitHub/DNS prerequisites and write implementation
      plan with frontend-design execution.
    tags:
      - website
      - marketing
      - frontend-design
      - distribution
      - openclaw
    icon: "\U0001F310"
    specDoc: docs/specs/clawchestra-ai-website-spec.md
  - id: git-sync
    title: Git Sync (Phase 1)
    status: complete
    priority: 1
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
    priority: 2
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
    priority: 3
    nextAction: Code shipped — awaiting verification
    tags:
      - ui
      - kanban
      - ux
    specDoc: docs/specs/collapsible-kanban-columns-spec.md
  - id: project-card-opens-kanban
    title: Project Card Opens Kanban Directly
    status: complete
    priority: 4
    nextAction: Verified and shipped
    tags:
      - ui
      - ux
      - navigation
    specDoc: docs/specs/project-card-opens-kanban-spec.md
  - id: draggable-kanban-columns
    title: Draggable Kanban Columns
    status: complete
    priority: 5
    nextAction: Code shipped — awaiting verification
    tags:
      - ui
      - kanban
      - ux
    specDoc: docs/specs/draggable-kanban-columns-spec.md
  - id: collapsible-sidebar
    title: Collapsible Sidebar
    status: complete
    priority: 6
    nextAction: Built — needs manual testing
    tags:
      - ui
    icon: "\U0001F4D0"
    specDoc: docs/specs/collapsible-sidebar-spec.md
    planDoc: docs/plans/collapsible-sidebar-plan.md
  - id: deliverable-lifecycle-orchestration
    title: Deliverable Lifecycle Orchestration
    status: complete
    priority: 7
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
    priority: 8
    nextAction: 'Hands-on review: what works, what doesn''t, what''s missing'
    tags:
      - ui
      - ux
      - roadmap
    icon: "\U0001F3A8"
---

# Clawchestra — Roadmap

Individual roadmap item docs live in `roadmap/` folder. Spec/plan docs in `docs/specs/` and `docs/plans/`.
