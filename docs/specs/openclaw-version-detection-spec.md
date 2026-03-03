# OpenClaw Version Detection

> Capture and use the connected OpenClaw server version to enable diagnostics, feature gating, and update nudges.

## Context

Clawchestra currently has zero knowledge of which OpenClaw version it's connected to. The `connect` RPC handshake may include server version metadata in its response, but Clawchestra doesn't capture it. This means:

- Diagnostic logs can't reference the server version
- Features requiring newer OpenClaw can't be gracefully gated
- Users running outdated versions get no indication they should update
- Agents working on Clawchestra can't reason about server capabilities

## Design

### Phase 1: Capture + Store (Trivial)

- After successful `connect` RPC in `tauri-websocket.ts`, extract version info from the response
- Store in dashboard store: `openclawServerVersion: string | null`
- Log at connect time: `[TauriWS] Connected to OpenClaw v2026.2.26`
- Expose via a getter so gateway code, error handlers, and diagnostic dumps can reference it
- No UI changes

### Phase 2: Update Nudge

- Compare stored version against a known "latest" version
- Latest version could be: hardcoded per Clawchestra release, or fetched from a lightweight endpoint
- If behind, surface a subtle indicator:
  - Small badge on the Settings icon in the sidebar
  - A line in the settings page: "OpenClaw v2026.2.22 — update available (v2026.2.26)"
  - Optionally, a one-time dismissable toast on connect
- Never block functionality — just inform

### Phase 3: Feature Gating

- Use the stored version to gate features that require newer OpenClaw
- Example: ACP agent routing UI requires .26+ — if version < .26, grey out with "Requires OpenClaw v2026.2.26+"
- Avoids cryptic RPC errors when users try features their server doesn't support
- Combine with RPC feature probing for defense in depth (version check + capability probe)

## Backwards Compatibility

- If the `connect` response doesn't include version info (older servers), store `null` and skip all version-dependent logic
- Phase 2/3 features degrade to invisible — no nudges, no gating, just the current behavior
- No protocol changes needed

## Technical Notes

- The `connect` RPC response shape needs to be inspected — verify whether OpenClaw .22+ includes a version field
- If not in the connect response, may need to probe via a separate RPC (e.g. `system.info` or `system.version`)
- Version comparison should handle the `YYYY.M.DD-patch` format (e.g. `2026.2.26`)
- Consider storing `openclawServerCapabilities` alongside version for richer feature detection

## Files Likely Affected

| File | Change |
|------|--------|
| `src/lib/tauri-websocket.ts` | Capture version from connect response |
| `src/lib/store.ts` | Add `openclawServerVersion` state |
| `src/lib/gateway.ts` | Expose version in diagnostic logging |
| `src/components/sidebar/Sidebar.tsx` | Settings badge (Phase 2) |
| Settings UI component | Version display + update nudge (Phase 2) |

## Connection Failure Diagnostics (learned 2026-03-03)

Version detection alone isn't enough. When the connection to OpenClaw fails, Clawchestra currently gives **zero feedback** — it silently retries forever. This section captures failure modes discovered during the 2026.3.2 upgrade that a first-friend user would be completely stuck on.

### Device re-pairing after gateway update

When OpenClaw updates and the gateway is reinstalled (`openclaw gateway install --force`), all device trust is invalidated. Clawchestra's WebSocket connect handshake fails with a device-auth error, but the user sees nothing — just a disconnected state with no explanation.

The fix requires running `openclaw devices approve --latest` in a terminal, which a non-technical user would never discover.

**Required:** If the connect handshake returns a pairing/auth failure, surface an actionable message: "Device pairing required. Run `openclaw devices approve --latest` in your terminal." This should appear in a connection status banner, not just logs.

### Silent extension API breakage

OpenClaw 2026.3.2 added a mandatory `auth` field to `registerHttpRoute`. Without it, the route silently fails — no error, no exception, the sync extension just stops working. Clawchestra's sync data disappears with no indication of why.

**Required:** After registering the HTTP route, verify it was actually registered (e.g., probe the route or check for an acknowledgement). If registration fails silently, surface a diagnostic message.

### Gateway path breakage after pnpm update

`pnpm update -g openclaw` installs to a new directory (`openclaw@2026.3.2/...`) but the LaunchAgent plist still points to the old directory (`openclaw@2026.2.22-2/...`). The gateway crashes on start with `MODULE_NOT_FOUND`. The user must run `openclaw gateway install --force` to regenerate the plist — non-obvious.

**Consideration:** If Clawchestra detects the gateway is unreachable AND the CLI version doesn't match the last-known gateway version, suggest "Try `openclaw gateway install --force && openclaw gateway start`".

### Design implication

These failures argue for a **connection health panel** — a small, normally-hidden status area that expands when the connection is unhealthy, showing the specific failure reason and an actionable fix. This is more important than version nudges for first-friend readiness.

## Open Questions

1. Does the `connect` RPC response already include a server version field? Need to inspect against .22 and .26.
2. How to resolve "latest available version" — hardcode per release, or fetch from a known URL?
3. Should the update nudge link to release notes or just state the version number?
4. How granular should feature gating be — per-version or per-capability?
5. What error codes/messages does the connect handshake return for device-auth failures? Need to inspect the WebSocket response to know what to match on.
6. Can we detect the `registerHttpRoute` silent failure from the Clawchestra side, or do we need OpenClaw to return an acknowledgement?
