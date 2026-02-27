---
title: OpenClaw Version Detection
id: openclaw-version-detection
status: pending
tags: [openclaw, infrastructure, diagnostics]
icon: "🔍"
specDoc: docs/specs/openclaw-version-detection-spec.md
nextAction: "Spec written — Phase 1 (capture + store) is trivial. Phase 2 (update nudge) depends on resolving how to fetch the latest available version."
lastActivity: "2026-02-27"
---

# OpenClaw Version Detection

> Capture and surface the connected OpenClaw server version to enable diagnostics, update nudges, and feature gating.

Full spec: [`docs/specs/openclaw-version-detection-spec.md`](../docs/specs/openclaw-version-detection-spec.md)

---

## The Problem

Clawchestra currently has zero knowledge of which OpenClaw version it's connected to. This causes three practical problems:

1. **No diagnostics** — bug reports and logs can't include the server version, making issues harder to reproduce
2. **Silent failures** — features that require a newer OpenClaw (e.g. ACP agent routing requires .26+) fail with cryptic RPC errors rather than a clear "please update" message
3. **No update nudges** — users running outdated versions get no indication they're behind

## What We're Building

### Phase 1 — Capture + Store (trivial, do this first)
- After `connect` RPC succeeds in `tauri-websocket.ts`, extract the version field from the response
- Store as `openclawServerVersion: string | null` in the dashboard store
- Log at connect time: `[TauriWS] Connected to OpenClaw v2026.2.26`
- Expose the value everywhere (error handlers, diagnostic dumps, feature gates)
- No UI changes in Phase 1

### Phase 2 — Update Nudge
- Compare stored version to a known "latest" version (hardcoded per Clawchestra release, or fetched from a lightweight endpoint)
- If behind, surface a **subtle** indicator:
  - Small badge on the Settings icon in the main sidebar
  - Line in settings: `"OpenClaw v2026.2.22 — update available (v2026.2.26)"`
  - Optional one-time dismissable toast on connect
- Never block functionality — inform only

### Phase 3 — Feature Gating
- Use the stored version to gate features that need newer OpenClaw before exposing them in the UI
- Example: Per-Chat Agent Routing (ACP) requires .26+ → grey out with tooltip "Requires OpenClaw v2026.2.26+"
- Combine with RPC capability probes (version check + probe = defense in depth)

## Key Constraints
- If `connect` response has no version field (older servers), store `null` — all version-dependent logic silently skips
- Phase 2/3 degrade gracefully — no nudges, no gating, exactly current behaviour
- Version format is `YYYY.M.DD[-patch]` (e.g. `2026.2.26`) — comparison must handle this format

## Files Affected
| File | Change |
|------|--------|
| `src/lib/tauri-websocket.ts` | Capture version from connect response |
| `src/lib/store.ts` | Add `openclawServerVersion: string \| null` |
| `src/lib/gateway.ts` | Include version in diagnostic logging |
| `src/components/sidebar/Sidebar.tsx` | Settings badge for update nudge (Phase 2) |
| Settings UI | Version display + update nudge line (Phase 2) |

## Open Questions
1. Does the `connect` response already include a `version` field in .22+? Needs inspection
2. If not, does a `system.info` or `system.version` RPC exist?
3. How to resolve "latest available version" — hardcode per release or fetch from a URL?
4. Should the update nudge link to release notes?
