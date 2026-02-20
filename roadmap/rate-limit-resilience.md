# Rate Limit Resilience & Provider Failover

> Surface API rate limits in the Clawchestra chat UX, guide users through failover setup, and gracefully handle exhausted providers.

## Status: Pending (exploratory spec written, needs research)

## Context

On 2026-02-19 ~22:31, user hit Anthropic API session limits. Sent a message, received no reply, had no indication of what happened. Discovered the issue manually ~25 minutes later by checking subscription status externally.

OpenClaw has model failover built in (`/concepts/model-failover`) but:
- Current config has `fallbacks: []` (no backup)
- Active bug (#19249) where failover doesn't activate at runtime
- No signals surfaced to the Clawchestra chat UI

## Three Layers

1. **Rate Limit Detection & Display** — detect when OpenClaw is rate-limited, show clear UX (block input or queue, show reset countdown if available)
2. **Failover Guidance** — at onboarding (FFR tie-in) and at rate-limit time, guide users to set up a backup provider via OpenClaw CLI
3. **Smart Model Routing** — Sonnet for chat, Opus for builds. Per-session model overrides.

## Research Checklist

- [ ] Validate OpenClaw failover mid-session (same provider rotation + cross-provider fallback)
- [ ] Identify gateway events for rate limit / failover (FailoverError? stream events?)
- [ ] Check if gateway exposes auth profile health / cooldown status
- [ ] Check if Retry-After headers are passed through
- [ ] Validate per-session model override persistence (`session_status(model=...)`)
- [ ] Assess bug #19249 fix timeline

## Open Decisions

- Onboarding: inline in FFR or separate settings step?
- Message handling during exhaustion: block input, queue with indicator, or allow sending with warning?
- Smart routing: per-session override vs config-level primary swap?

## Links

- Spec: `docs/specs/rate-limit-resilience-spec.md`
- OpenClaw failover docs: https://docs.openclaw.ai/concepts/model-failover
- OpenClaw bug: https://github.com/openclaw/openclaw/issues/19249
- Related: FFR (`first-friend-readiness`), chat infrastructure bugs
