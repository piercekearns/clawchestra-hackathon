---
title: "Data Retrofit — Phase B.1"
type: refactor
date: 2026-02-13
status: ready
parent_plan: docs/plans/2026-02-13-refactor-project-architecture-overhaul-plan.md
parent_spec: docs/specs/project-architecture-overhaul-spec.md
reviewed_by: [dhh-rails-reviewer, kieran-typescript-reviewer, code-simplicity-reviewer]
note: "Reviewed as part of parent plan. This is the data-only extraction."
---

# Data Retrofit — Phase B.1

Bring every existing project into compliance with the scan-based schema. No code changes — only data file creation and conversion.

## Safety Principles

1. **Never delete original content.** All existing markdown body text is preserved below YAML frontmatter.
2. **Never drop items.** Every roadmap item in the original file must appear either in the YAML `items:` array OR in the markdown body. Count items before and after.
3. **Conservative status mapping.** If an item's status is ambiguous, default to `pending`. Only mark `complete` if clearly marked as done/shipped/✅.
4. **Preserve dates.** Completed items going to CHANGELOG must carry their completion date where available.
5. **Git is the rollback.** All repos have git history. If conversion goes wrong, `git checkout -- ROADMAP.md` restores the original.
6. **Don't break repos.** No changes to source code, configs, package.json, or anything besides PROJECT.md, ROADMAP.md, and CHANGELOG.md.

## Target Format Reference

Pipeline Dashboard's ROADMAP.md is the reference format:

```yaml
---
items:
  - id: project-modal-improvements
    title: "Project Modal Improvements"
    status: in-progress
    priority: 1
    nextAction: "Test all 6 phases, verify build"
    tags: [ui, ux, core]
    icon: "🎨"
    specDoc: docs/specs/project-modal-improvements-spec.md
    planDoc: docs/plans/project-modal-improvements-plan.md
---

# Pipeline Dashboard — Roadmap

Individual roadmap item docs live in `roadmap/` folder.
```

## Audit Summary (Pre-Retrofit State)

| Repo | PROJECT.md | ROADMAP format | Active items | Completed items | CHANGELOG |
|------|-----------|---------------|--------------|-----------------|-----------|
| pipeline-dashboard | ✅ Good | ✅ YAML items | 6 | Has CHANGELOG | ✅ Exists |
| ClawOS | ✅ Minimal | ❌ Markdown bullets | ~8 active | ~35 completed | ❌ Missing |
| memestr | ✅ Minimal | ❌ Markdown bullets | ~15 active | ~17 completed | ❌ Missing |
| Shopify-Fabric-Theme | ✅ Minimal | ❌ Markdown bullets | ~34 active | ~40 completed | ❌ Missing |
| piercekearns.com | ✅ Minimal | ❌ Markdown bullets | 0 active | ~8 completed | ❌ Missing |
| clawd | ✅ Minimal | N/A (no roadmap) | N/A | N/A | ❌ Missing |

---

## Phase 1: Enrich PROJECT.md Files

For each repo, enrich the existing PROJECT.md with data from catalog stubs and the repo itself. Don't overwrite existing fields — only add missing ones.

### 1.1 pipeline-dashboard/PROJECT.md

**Current state:** Has title, status, priority, type, tags, icon, lastActivity, nextAction.
**Enrichment needed:**
- Add `repo: piercekearns/pipeline-dashboard` (if public)
- Update `nextAction` to reflect current state (data retrofit)
- Add markdown body with brief project description

### 1.2 ClawOS/PROJECT.md

**Current state:** Has title, status, priority, type, tags, icon, lastActivity, nextAction.
**Enrichment needed:**
- Add markdown body with project description (from IDEAS.md context)
- Already has good frontmatter, minimal changes needed

### 1.3 memestr/PROJECT.md

**Current state:** Has title, status, priority, type, tags, icon, repo, lastActivity, nextAction.
**Enrichment needed:**
- Already well-populated, minimal changes needed
- Markdown body already has description

### 1.4 Shopify-Fabric-Theme/PROJECT.md

**Current state:** Has title, status, type, tags, icon, lastActivity. Missing repo, nextAction.
**Catalog source:** `catalog/projects/revival/REVIVAL.md` has `repo: revivalfightwear/Shopify-Fabric-Theme`, `nextAction: Add Geist Pixel fonts`.
**Enrichment needed:**
- Add `repo: revivalfightwear/Shopify-Fabric-Theme`
- Add `nextAction` from catalog or current roadmap P1 #1
- Add markdown body with project description

### 1.5 piercekearns.com/PROJECT.md

**Current state:** Has title, status, type, tags, icon, lastActivity. Missing nextAction.
**Enrichment needed:**
- Add `nextAction: No active work — V1 live`
- Add markdown body with project description
- Consider if `status: dormant` is more accurate than `simmering` (no active items)

### 1.6 clawd/PROJECT.md

**Current state:** Has title, status, type, tags, icon, lastActivity. Missing nextAction.
**Enrichment needed:**
- Add `nextAction` if applicable
- Add markdown body with project description

---

## Phase 2: Convert ROADMAP.md Files

Convert 4 repos from markdown bullet format to YAML frontmatter `items:` array. Preserve ALL original markdown as the body.

### Conversion Rules

1. **Extract top-level deliverables** as YAML items (major phases, P1 items, etc.)
2. **ID format:** kebab-case slug derived from item title
3. **Status mapping:**
   - `✅ / [x] / DONE / Complete / Implemented / Live` → `complete`
   - `🔄 / [-] / In Progress / WIP` → `in-progress`
   - `⏳ / [ ] / TODO / Not Started / Ready / Backlog / Scoped` → `pending`
   - `⏸️ / ON HOLD / Blocked` → `pending` (with blockedBy or note in nextAction)
4. **Priority:** Sequential 1, 2, 3... based on document order (P0 items first, then P1, etc.)
5. **Preserve markdown body:** The ENTIRE original roadmap content goes below the `---` frontmatter delimiter. Nothing is deleted.

### 2.1 ClawOS/ROADMAP.md

**Conversion strategy:**
- Phases 0-4 are ALL completed → these go to CHANGELOG.md (Phase 3)
- Phase 5 items: partially complete — extract active items as YAML
- Stretch/Deferred/Post-Demo: extract as YAML items with `pending`
- Demo Recording Checklist: completed → CHANGELOG

**YAML items to extract (active/pending only):**

```yaml
items:
  - id: bot-standard-contract
    title: "Bot Standard Definition Contract"
    status: in-progress
    priority: 1
    nextAction: "Unified schema for npub, nsec, wallet, name, description"
    tags: [bots, sdk]
  - id: slash-commands-ui
    title: "Slash Commands with Structured UI"
    status: in-progress
    priority: 2
    nextAction: "Additional command pilots (/calc, /timer, /newbot)"
    tags: [ui, commands]
  - id: app-install-model
    title: "App Install Model Discovery Spike"
    status: in-progress
    priority: 3
    nextAction: "Evaluate options (skill registry vs package registry vs Nostr events)"
    tags: [architecture]
  - id: feed-modality-toggle
    title: "Feed Modality Toggle Exploration"
    status: pending
    priority: 4
    nextAction: "Scope media/video-forward modality preview"
    tags: [ui, feed]
  - id: nwc-zap-flow
    title: "Full NWC Zap Flow"
    status: pending
    priority: 5
    nextAction: "LNURL + invoice + pay + receipt verification"
    tags: [wallet, stretch]
  - id: memestr-remote-config
    title: "Memestr Remote Config Mutation"
    status: pending
    priority: 6
    tags: [bots, stretch]
  - id: apk-distribution
    title: "APK Distribution Pipeline"
    status: pending
    priority: 7
    nextAction: "EAS build or prebuild/Gradle + install/share flow"
    tags: [deployment, post-demo]
  - id: onboarding-flow
    title: "Onboarding (Keys, Relays, OpenClaw)"
    status: pending
    priority: 8
    tags: [ux, post-demo]
  - id: safety-defaults
    title: "Hard Safety Defaults"
    status: pending
    priority: 9
    tags: [security, post-demo]
```

**Completed items → CHANGELOG (with dates where available):**
- Phase 0: Agent-Ready Repository Baseline (2026-02-07)
- Phase 1: Planning Hardening (2026-02-07)
- Phase 2: Build Track (2026-02-08)
- Phase 3: Human-Last Inputs (2026-02-08)
- Phase 4: Post-Validation Hardening (2026-02-08)
- Bot Store placeholder UX (2026-02-08)
- Wallet placeholder UX (2026-02-08)
- Demo Recording (2026-02-08)

**Item count verification:** 9 active YAML items + 8 CHANGELOG entries + full markdown body = ALL content preserved.

### 2.2 memestr/ROADMAP.md

**Conversion strategy:**
- Phase 0 Discussion Gates: completed → CHANGELOG
- Phase 0 Live-Validation: completed → CHANGELOG
- Phase 1 (P1.1-P1.6): ALL completed → CHANGELOG
- Phase 2 Deployment: mixed — extract active items
- Phase 3-5: all pending → extract as YAML items
- Future Phases: extract as YAML items
- "Completed ✅" section: → CHANGELOG

**YAML items to extract (active/pending only):**

```yaml
items:
  - id: deploy-uptime-kuma
    title: "Deploy Uptime Kuma"
    status: pending
    priority: 1
    nextAction: "Self-hosted, ~100MB RAM, Telegram alerts"
    tags: [deployment, monitoring]
  - id: configure-telegram-alerts
    title: "Configure Telegram Alerts"
    status: pending
    priority: 2
    tags: [deployment, monitoring]
  - id: monitor-iterate
    title: "Monitor and Iterate"
    status: pending
    priority: 3
    nextAction: "Continue weekend runtime observation"
    tags: [deployment]
  - id: bot-identity-polish
    title: "Bot Profile & Identity Polish"
    status: pending
    priority: 4
    nextAction: "Name, bio, avatar, welcome message, error messages"
    tags: [identity, ux]
  - id: rate-limit-messaging
    title: "Rate Limit Messaging"
    status: pending
    priority: 5
    tags: [ux]
  - id: donation-transparency
    title: "Donations & Transparency"
    status: pending
    priority: 6
    nextAction: "Auto-split to HRF/OpenSats, monthly transparency post"
    tags: [donations]
  - id: open-source-productization
    title: "Open Source & Self-Host Productization"
    status: pending
    priority: 7
    nextAction: "Repo sanitization, guided setup, deployment profiles"
    tags: [open-source]
    planDoc: docs/plans/2026-02-07-plan-open-source-self-host-productization.md
```

**Completed items → CHANGELOG (with dates):**
- Phase 0 Discussion Gates approved (2026-02-05)
- Phase 0 Live-Validation complete (2026-02-06)
- Phase 1 P1.1-P1.6 implemented (2026-02-06)
- Hosted deployment live (2026-02-07)
- Duplicate-zap fix (2026-02-07)
- Bounded zap dedupe (2026-02-07)
- Live relay validation (2026-02-06)
- Prod-mode daemon (2026-02-06)
- Prompt hardening (2026-02-06)
- Documentation created (2026-02-04)
- Tech decisions finalized (2026-02-04)
- Plus all items from "Completed ✅" section

**Item count verification:** 7 active YAML items + 17+ CHANGELOG entries + full markdown body.

### 2.3 Shopify-Fabric-Theme/ROADMAP.md

**Conversion strategy:**
- This is the largest roadmap (~803 lines). Extract P1 items as YAML.
- P2 and P3 items also extracted as YAML (lower priority numbers).
- Completed archive items → CHANGELOG.
- Full markdown body preserved below frontmatter.

**YAML items to extract:**

```yaml
items:
  # P1 - HIGH PRIORITY
  - id: unified-integration
    title: "Unified Customizer-Competition-Club Shop Integration"
    status: in-progress
    priority: 1
    nextAction: "Human review & testing checklist (Phases 0A, 1, 2 code complete)"
    tags: [integration, club-shop, competition]
    icon: "🔗"
    specDoc: docs/features/unified-customizer-competition-club-shop-integration.md
    planDoc: docs/plans/2026-02-12-feat-unified-customizer-competition-club-shop-integration-plan.md
  - id: club-shop-ui-overhaul
    title: "Club Shop UI Overhaul"
    status: in-progress
    priority: 2
    nextAction: "Execute 7 test scenarios after pilot feedback"
    tags: [ui, club-shop]
    icon: "🎨"
    specDoc: docs/features/club-suite-ui-overhaul-95FB35FF.plan.md
  - id: email-consistency-overhaul
    title: "Email Consistency & Aesthetic Overhaul"
    status: pending
    priority: 3
    nextAction: "Blocked by markup approval workflow migration"
    tags: [email]
    icon: "📧"
  - id: remotion-promo-video
    title: "Remotion Club Shop Promo Video"
    status: pending
    priority: 4
    tags: [video, marketing]
    icon: "🎬"
    planDoc: docs/plans/2026-01-30-remotion-club-shop-promo-video-plan.md
  - id: relaunch-club-order
    title: "Club Shop Relaunch Club Order"
    status: in-progress
    priority: 5
    nextAction: "Frontend UI pending (backend complete)"
    tags: [club-shop]
    icon: "🔄"
    specDoc: docs/features/club-shop-portal/relaunch-club-order-spec.md
  - id: club-shop-portal
    title: "Club Shop Portal"
    status: in-progress
    priority: 6
    nextAction: "Pending UI Kit integration"
    tags: [club-shop]
    icon: "🚀"
    specDoc: docs/features/club-shop-portal.md
  - id: posthog-analytics
    title: "PostHog Analytics"
    status: pending
    priority: 7
    tags: [analytics]
    icon: "📊"
  - id: mobile-notifications
    title: "Mobile Notifications (Pushover/Clawdbot)"
    status: pending
    priority: 8
    tags: [notifications]
    icon: "📱"
  - id: manual-order-portal
    title: "Manual Order Portal"
    status: pending
    priority: 9
    tags: [admin, club-shop]
    icon: "🛠️"
    specDoc: docs/features/manual-order-portal.md
  - id: public-competitions-phase-2
    title: "Public Competitions Phase 2"
    status: pending
    priority: 10
    tags: [competitions]
    specDoc: docs/features/public-competitions.md
  - id: home-page-upgrade
    title: "Home Page Layout Upgrade"
    status: pending
    priority: 11
    tags: [ui, homepage]
    specDoc: docs/features/home-page-upgrade.md
  - id: design-tools-page
    title: "Design Tools Utility Page"
    status: pending
    priority: 12
    tags: [ai, tools]
    specDoc: docs/features/design-tools-utility-page.md
  - id: revival-operations-dashboard
    title: "Revival Operation Dashboard"
    status: pending
    priority: 13
    tags: [admin, operations]
  - id: landing-page-gate
    title: "Interactive Landing Page Gate"
    status: in-progress
    priority: 14
    nextAction: "Server-render refactor + QA"
    tags: [ui, ux]
  - id: 3d-model-placeholders
    title: "3D Model Placeholder Images"
    status: pending
    priority: 15
    tags: [ui, performance]
    specDoc: docs/features/3d-model-placeholder-images.md
  - id: asset-protection
    title: "Asset Protection / Copycat Mitigation"
    status: pending
    priority: 16
    tags: [security]
  - id: marketing-copy-audit
    title: "Marketing Copywriting Audit"
    status: pending
    priority: 17
    tags: [marketing, content]
    icon: "✍️"
  - id: seo-optimization
    title: "SEO Optimization & Programmatic SEO"
    status: pending
    priority: 18
    tags: [seo, marketing]
    icon: "🔍"
  - id: user-feedback-system
    title: "User Feedback System (Bug Reporting)"
    status: in-progress
    priority: 19
    nextAction: "Build bug reporting (positive feedback done)"
    tags: [ux, feedback]
    icon: "💬"
    specDoc: docs/features/user-feedback-system.md
  # P2 - MEDIUM PRIORITY
  - id: button-hover-animations
    title: "Button Hover Animations Polish"
    status: pending
    priority: 20
    tags: [ui, animations]
  - id: media-overlay-settings
    title: "Media Overlay Settings"
    status: pending
    priority: 21
    tags: [ui]
  - id: button-text-audit
    title: "Default Button Text Audit"
    status: in-progress
    priority: 22
    tags: [ui, settings]
  - id: button-link-audit
    title: "Button/Link Destination Audit"
    status: pending
    priority: 23
    nextAction: "Blocked by button text audit"
    tags: [ui, settings]
  - id: designmode-playback-fix
    title: "DesignMode Playback False Start"
    status: pending
    priority: 24
    tags: [animations, bug]
  - id: typewriter-targeting
    title: "Typewriter Targeting Alignment"
    status: pending
    priority: 25
    tags: [animations, bug]
  - id: underline-gap-slider
    title: "Underline Gap Slider Feedback Lag"
    status: pending
    priority: 26
    tags: [animations, bug]
  - id: gsap-expansion
    title: "GSAP Expansion Program"
    status: pending
    priority: 27
    tags: [animations]
  - id: step-by-step-images
    title: "Step-by-Step Image Block Support"
    status: pending
    priority: 28
    tags: [ui]
  - id: icon-system-overhaul
    title: "Icon System Overhaul (Rebuild)"
    status: pending
    priority: 29
    nextAction: "Rolled back Oct 2025 — needs safer architecture"
    tags: [ui, icons]
  # P3 - LOW PRIORITY
  - id: marquee-enhancements
    title: "Marquee System Enhancements"
    status: pending
    priority: 30
    tags: [ui]
  - id: jumbo-text-fix
    title: "Jumbo Text Visibility Regression"
    status: pending
    priority: 31
    tags: [ui, bug]
  - id: lenis-enhancements
    title: "Lenis / SmoothScroller Enhancements"
    status: pending
    priority: 32
    tags: [animations]
  - id: animation-performance
    title: "Animation Performance Optimization"
    status: pending
    priority: 33
    tags: [performance, animations]
  - id: code-quality
    title: "Code Quality Improvements"
    status: pending
    priority: 34
    tags: [code-quality]
```

**Completed items → CHANGELOG:**
- Playwright E2E de-scoped (2026-02-11)
- Club Shop Code Audit Findings (2026-02-11)
- Email Consistency & Redesign Audit (2026-01-27)
- Email Dashboard (2026-01)
- State Machine Process Flows (2026-01-15)
- UI Kit Aesthetic Guardrails (2026-01-14)
- P1.0-P1.3 Tech Eval, Security, Stripe, pnpm (2026-01-14)
- Plus ~30 items from Oct-Nov 2025 (referenced in archive)

**Item count verification:** 34 active YAML items + 7+ CHANGELOG entries + full 800-line markdown body.

### 2.4 piercekearns.com/ROADMAP.md

**Conversion strategy:**
- 0 active items. YAML `items:` array is empty.
- All 8 completed items → CHANGELOG.
- Full markdown body preserved (includes detailed specs, deployment research, etc.)

**YAML items:** `items: []` (empty — no active work)

**Completed items → CHANGELOG:**
- V1 MVP Implementation (2026-01-16)
- Mobile UX Improvements (2026-01-16)
- Games Integration (2026-01-16)
- Theme System (2026-01-16)
- Core Navigation (2026-01-16)
- Framework & Stack Decision (2026-01-16)
- Repository Structure (2026-01-14)
- Documentation Framework (2026-01-14)

---

## Phase 3: Create CHANGELOG.md Files

Create CHANGELOG.md for 5 repos (pipeline-dashboard already has one). Each CHANGELOG.md has YAML frontmatter `entries:` array.

### CHANGELOG.md Format

```yaml
---
entries:
  - id: item-slug
    title: "Item Title"
    completedAt: "2026-02-07"
    summary: "Brief description of what was completed"
---

# {Project Name} — Changelog
```

### 3.1 ClawOS/CHANGELOG.md — Create with 8 entries from completed phases
### 3.2 memestr/CHANGELOG.md — Create with 17+ entries from completed phases and section
### 3.3 Shopify-Fabric-Theme/CHANGELOG.md — Create with 7+ entries from completed archive
### 3.4 piercekearns.com/CHANGELOG.md — Create with 8 entries (all completed items)
### 3.5 clawd/CHANGELOG.md — Skip (no roadmap, nothing to migrate)

---

## Phase 4: Enrich Idea PROJECT.md Files

The 15 idea projects in `~/clawdbot-sandbox/projects/` already have minimal PROJECT.md files. Enrich them with data from their corresponding catalog stubs where available.

**Catalog stubs to pull from:**
- `catalog/projects/ideas/bitchat-research.md` → bitchat/
- `catalog/projects/ideas/bitcoin-time-machine.md` → bitcoin-time-machine/
- `catalog/projects/ideas/btc-folio.md` → btc-folio/
- `catalog/projects/nostr/botfather.md` → botfather/
- `catalog/projects/nostr/dating.md` → nostr-dating/
- `catalog/projects/nostr/commerce.md` → nostr-commerce/
- `catalog/projects/nostr/decentralized-reputation.md` → decentralized-reputation/
- `catalog/projects/nostr/distributed-cloudflare.md` → distributed-cloudflare/
- `catalog/projects/nostr/miniclip.md` → miniclip/
- `catalog/projects/nostr/white-noise-bots.md` → white-noise-bots/
- `catalog/projects/openclaw-browser-extension.md` → openclaw-browser-extension/
- `catalog/projects/openclaw-sdk.md` → openclaw-sdk/
- `catalog/projects/revival/redbird-app.md` → redbird-app/
- `catalog/projects/revival/revival-running.md` → revival-running/
- `catalog/projects/the-restricted-section/*.md` → the-restricted-section/

For each: copy missing frontmatter fields (priority, nextAction, tags) from catalog stub. Add markdown body with project description if the catalog stub has content.

---

## Phase 5: Validation

After all data work, verify:

- [ ] Every repo in `~/repos/` has `PROJECT.md` with valid frontmatter (passes `validateProject()`)
- [ ] Every `ROADMAP.md` uses frontmatter `items:` format (parseable by gray-matter)
- [ ] Every `ROADMAP.md` has a paired `CHANGELOG.md`
- [ ] In-flight projects have `priority` field
- [ ] No items were dropped (count check per repo)
- [ ] All markdown body content preserved in converted ROADMAP.md files
- [ ] Idea PROJECT.md files enriched with catalog data
- [ ] App loads all projects after hitting update (21 projects expected)

---

## Files Changed (Summary)

| File | Action |
|------|--------|
| `~/repos/pipeline-dashboard/PROJECT.md` | Enrich (add repo, update nextAction) |
| `~/repos/ClawOS/PROJECT.md` | Enrich (minor) |
| `~/repos/ClawOS/ROADMAP.md` | Convert to YAML frontmatter |
| `~/repos/ClawOS/CHANGELOG.md` | Create |
| `~/repos/memestr/PROJECT.md` | Enrich (minor) |
| `~/repos/memestr/ROADMAP.md` | Convert to YAML frontmatter |
| `~/repos/memestr/CHANGELOG.md` | Create |
| `~/repos/Shopify-Fabric-Theme/PROJECT.md` | Enrich (add repo, nextAction) |
| `~/repos/Shopify-Fabric-Theme/ROADMAP.md` | Convert to YAML frontmatter |
| `~/repos/Shopify-Fabric-Theme/CHANGELOG.md` | Create |
| `~/repos/piercekearns.com/PROJECT.md` | Enrich (minor) |
| `~/repos/piercekearns.com/ROADMAP.md` | Convert to YAML frontmatter |
| `~/repos/piercekearns.com/CHANGELOG.md` | Create |
| `~/repos/clawd/PROJECT.md` | Enrich (minor) |
| 15x `~/clawdbot-sandbox/projects/*/PROJECT.md` | Enrich with catalog data |
