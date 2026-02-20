# Rate Limit Resilience

> Surface API rate limits in the Clawchestra chat UX, guide users through failover setup, and gracefully handle exhausted providers.

**Status:** Exploratory — requires validation of OpenClaw failover behaviour  
**Item ID:** `rate-limit-resilience`  
**Dependencies:** OpenClaw model failover (docs: `/concepts/model-failover`), FFR onboarding (potential tie-in)

---

## Problem

When the user hits API rate limits (e.g., Anthropic Claude Max subscription ceiling), the chat silently fails — messages are sent but no reply arrives. There is no indication of what happened, why, or when it will resolve. The user discovers the issue only by checking external dashboards or waiting.

This is compounded by:
- No failover configured (current state: `fallbacks: []`)
- No awareness in the app of rate limit state
- No guidance for users on how to set up redundancy
- No mechanism to prevent futile message-sending during exhaustion

---

## Research Required (pre-build)

### 1. OpenClaw Failover Validation

The docs describe model failover, but there's an active bug (#19249, filed 2026-02-18) where failover doesn't activate at runtime — only on session creation. Before building anything, we need to validate:

- [ ] Does profile rotation (same provider, different auth) work mid-session?
- [ ] Does model fallback (different provider) work mid-session?
- [ ] What events does the gateway emit when rate-limited? (`FailoverError`? specific stream event?)
- [ ] What events does the gateway emit when it successfully fails over to a backup?
- [ ] Is there a way to query current provider/profile state from the frontend? (e.g., which profile is active, cooldown status)
- [ ] Does the gateway expose rate limit reset times (from provider `Retry-After` headers)?
- [ ] When a primary profile comes off cooldown, does OpenClaw auto-switch back, or does it stay on the fallback?
- [ ] What happens to queued/in-flight messages when rate limits hit? Are they retried or dropped?

### 2. Auth Profile Setup Flow

OpenClaw supports multiple auth profiles per provider and across providers:
- `type: "api_key"` — manual API key
- `type: "oauth"` — OAuth login (e.g., Anthropic Max, Google)

Current user config has two Anthropic profiles (`anthropic:clawdbot` and `anthropic:default`) but no cross-provider fallback (e.g., OpenRouter).

Questions to resolve:
- [ ] Can a user add a second provider's auth via `openclaw` CLI without disrupting the primary?
- [ ] What's the simplest path to add an OpenRouter API key as fallback? (CLI command sequence)
- [ ] Can we detect from the app whether the user has >1 auth profile configured?
- [ ] Can we detect whether `model.fallbacks` is configured and non-empty?
- [ ] Is there a gateway API/event that exposes auth profile health? (e.g., `GET /auth/status`)

### 3. Model Switching for Cost Optimisation

The user wants to run Sonnet 4.6 for general chat and Opus 4.6 only for heavy work (tmux builds, etc.). This is adjacent:
- [ ] Does OpenClaw support per-session model overrides that the app could set? (e.g., chat session uses Sonnet, build sessions use Opus)
- [ ] Can the lifecycle buttons set a model override in the prompt? (e.g., build button requests Opus)
- [ ] What's the UX for switching between models mid-session vs per-session?

---

## Proposed Feature: Three Layers

### Layer 1: Rate Limit Detection & Display (app-side)

**Goal:** When the user hits rate limits, they know immediately.

- Detect rate limit / failover errors from OpenClaw event stream
- Show a distinct status indicator in the chat bar:
  - ⚠️ "Rate limited — resets in ~X min" (if reset time available)
  - ⚠️ "Rate limited — waiting for reset" (if no reset time)
  - 🔄 "Switched to backup model" (if failover succeeded)
- Prevent the user from sending messages into the void (or queue them with a visible indicator)
- When the rate limit clears, auto-resume and notify: "Back online"

**Event detection approach (needs validation):**
- Listen for `FailoverError` in the chat event stream
- Parse cooldown/retry information from gateway responses
- Possibly poll a gateway status endpoint for auth profile health

### Layer 2: Failover Guidance (onboarding + just-in-time)

**Goal:** Users know that failover exists and how to set it up, without requiring it.

**At onboarding (FFR tie-in):**
- After primary auth is configured, offer a skippable step: "Add a backup provider for redundancy"
- Explain in plain language: "If your main API hits its limit, Clawchestra can automatically switch to a backup"
- Provide step-by-step: how to add an OpenRouter key (or second OAuth) via `openclaw` CLI
- This is guidance only — Clawchestra doesn't handle the keys, OpenClaw does

**At rate-limit time (just-in-time guidance):**
- Two UI paths:
  1. **Failover configured:** "Rate limited on Anthropic. Switching to [backup model]..." → seamless, informational
  2. **No failover configured:** "Rate limited. No backup provider configured." → explain how to add one, with a "Learn more" link or inline guide. Block/queue further messages until resolved.

### Layer 3: Smart Model Routing (future)

**Goal:** Use cheaper models for routine work, expensive models for heavy work.

- Default chat session: Sonnet 4.6 (cheaper, fast, good enough for conversation)
- Build/review sessions (tmux): Opus 4.6 (max capability for code generation)
- Lifecycle button prompts could include a model hint that the app sends as a session override
- Settings panel: "Default model" vs "Build model" selector
- OpenClaw's `session_status(model=...)` tool can set per-session overrides — validate if this persists correctly

---

## UX Flows

### Flow A: Rate Limit Hit (no failover)

```
User sends message
  → OpenClaw returns FailoverError (all profiles exhausted)
  → Chat bar shows: ⚠️ "API limit reached — no backup configured"
  → Message input disabled or shows warning overlay
  → Inline card: "Set up a backup provider to avoid this next time"
    → Expandable guide: CLI commands to add OpenRouter key + configure fallbacks
  → Background: poll/listen for rate limit reset
  → On reset: "Back online ✓" → re-enable input
```

### Flow B: Rate Limit Hit (failover configured)

```
User sends message
  → OpenClaw rate-limits primary, rotates to fallback profile/model
  → Chat bar shows: 🔄 "Using backup model (Sonnet 4.6 via OpenRouter)"
  → Chat continues normally on fallback
  → When primary comes off cooldown: auto-switch back (if OpenClaw does this)
  → Chat bar shows: ✓ "Back on primary model"
```

### Flow C: Onboarding (FFR)

```
Primary auth configured
  → "Want to add a backup provider?" (skippable)
  → "This means if your main API hits its limit, the app switches automatically"
  → Step-by-step: openclaw CLI commands
  → Verification: "Backup configured ✓" or "Skipped — you can do this later in Settings"
```

---

## Technical Approach (pending validation)

### What Clawchestra needs to know from OpenClaw

| Signal | Source | Status |
|--------|--------|--------|
| Rate limit error occurred | Event stream / error response | Needs validation |
| Failover to backup succeeded | Event stream | Needs validation |
| Which model/profile is currently active | Gateway API? | Unknown |
| Whether fallbacks are configured | Config read / gateway API | Likely available |
| Rate limit reset time | Provider `Retry-After` → gateway | Unknown |
| Primary profile back online | Gateway event / polling | Unknown |

### Open Questions

1. **Can we get rate limit info without polling?** Push events preferred.
2. **Does OpenClaw pass through `Retry-After` headers?** If so, we can show countdown timers.
3. **Is there a lightweight gateway health endpoint?** Something like `GET /status` that includes auth profile health.
4. **Should we handle this at the webchat protocol level or the app level?** If OpenClaw's webchat already handles some of this, we should build on top rather than around.
5. **What's the behaviour of the existing `FailoverError`?** Is it emitted as a chat event, a system bubble, or just a log? What data does it carry?
6. **Bug #19249 — is there a fix timeline?** If failover is broken at runtime, our "seamless failover" UX is blocked until it's fixed. We'd still build Layer 1 (detection + display) and Layer 2 (guidance), but Layer 3 (smart routing) needs working failover.

---

## Scope Boundaries

**In scope:**
- Rate limit detection and display in chat UX
- Failover status indicator
- Just-in-time setup guidance when rate limited with no failover
- Onboarding guidance (FFR tie-in) for backup provider
- Message queuing/blocking during exhaustion

**Out of scope (for this item):**
- Managing auth keys directly in Clawchestra (keys stay in OpenClaw)
- Building our own failover logic (use OpenClaw's)
- Per-message cost tracking (separate feature)
- Model selection UI (partially in scope for Layer 3, but full model picker is separate)

---

## Related

- **FFR (first-friend-readiness):** Onboarding flow where backup provider guidance could live
- **Chat infrastructure bugs:** Rate limit errors may interact with existing streaming/recovery bugs
- **OpenClaw #19249:** Model failover not activating at runtime — critical dependency
- **OpenClaw model failover docs:** `/concepts/model-failover`
- **Cost optimisation:** Sonnet for chat / Opus for builds is Layer 3 of this spec
