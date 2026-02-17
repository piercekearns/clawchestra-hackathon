# Deliverable Lifecycle Orchestration

> Make roadmap deliverables operationally obvious: what exists, what is missing, and the single next action to run.

---

**Roadmap Item:** `deliverable-lifecycle-orchestration`
**Status:** Draft
**Created:** 2026-02-17

## Problem

Working a roadmap item currently requires manual context switching:

1. Open item
2. Inspect if spec/plan exist
3. Decide next action manually
4. Open chat and retype context-heavy prompts

This adds friction and causes drift between roadmap intent and execution cadence.

## Product Goal

From a roadmap item detail view, show the current lifecycle state and one primary action button that prepares a high-quality, editable chat prompt.

## Lifecycle Model (MVP)

Use file-backed detection plus roadmap status:

1. `spec` artifact present if `specDoc` resolves and file exists
2. `plan` artifact present if `planDoc` resolves and file exists
3. `build` is inferred from roadmap status:
   `in-progress` or `complete` => build started

No manual toggles for artifact status.

## UX Requirements

### 1) Artifact State Badges

For each roadmap item detail:

- `Spec: Present|Missing`
- `Plan: Present|Missing`
- `Build: Not Started|In Progress|Complete` (derived from status)

Badge states must be deterministic from files + item status to avoid drift.

### 2) Single Dynamic Next Action

Show one primary CTA based on lifecycle state:

1. Missing spec => `Create Spec`
2. Spec present, missing plan => `Create Plan`
3. Spec+plan present, build not started => `Run Build`
4. Build in progress/complete => `Continue Build` (or hidden if not needed)

### 3) Chat Prefill Automation

Clicking CTA should:

1. Open the chat drawer
2. Prefill composer with an editable prompt
3. Include concrete context:
   - project title/id
   - roadmap item id/title
   - known artifact paths (`specDoc`, `planDoc`)
   - requested action (`create spec`, `create plan`, `run build`)

User must be able to edit before send.

## Prompt Templates (Initial)

### Create Spec

"Please create a technical spec for roadmap item `{item.title}` (`{item.id}`) in project `{project.title}`. Use repository conventions and write to `{specDocPath}`."

### Create Plan

"Please create an implementation plan for roadmap item `{item.title}` (`{item.id}`) in project `{project.title}` based on `{specDocPath}`. Save to `{planDocPath}`."

### Run Build

"Please execute the build workflow for roadmap item `{item.title}` (`{item.id}`) in project `{project.title}`, using `{specDocPath}` and `{planDocPath}` as source of truth."

## Scope

In scope:

- roadmap-item lifecycle detection
- lifecycle badges
- single dynamic CTA
- chat open + composer prefill

Out of scope:

- auto-submitting prompts
- deep multi-stage workflow orchestration UI
- backend task engine changes

## Technical Notes

Likely touchpoints:

- `src/components/modal/RoadmapItemDetail.tsx`
- `src/components/chat/ChatShell.tsx`
- `src/App.tsx` (state plumbing for chat open + prefill action)
- `src/lib/roadmap.ts` (artifact resolution helpers if needed)

## Acceptance Criteria

1. Roadmap detail shows deterministic Spec/Plan/Build states.
2. Only one primary CTA is visible at a time.
3. CTA opens chat and inserts contextual prompt text.
4. Prompt is editable before send.
5. State remains correct after refresh/reload without manual syncing.
