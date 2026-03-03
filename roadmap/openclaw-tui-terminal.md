# OpenClaw TUI as Terminal Type Option

> Add `openclaw tui` as a selectable terminal type in the hub, with version detection and gateway compatibility checks to ensure it works reliably for all users.

## Status: Built (core) — needs version compatibility layer

The core implementation is complete:
- `openclaw-tui` added to `HubAgentType`
- Agent detection wired in Rust (`detect_agents` checks for `openclaw` binary)
- `getAgentCommand` returns `openclaw tui` (with resolved path from detection)
- `AGENT_LABELS` and `AgentIcon` mapped
- Terminal icon used (consistent with other terminal agents)

## Problem Discovered: Device Signature Invalid

When launching `openclaw tui`, the error "device signature invalid" appeared. Root cause investigation revealed:

- **CLI version:** 2026.2.26
- **Gateway version:** 2026.2.22-2 (running process, visible in `OPENCLAW_SERVICE_VERSION` env)
- **Auth hardening** between these versions changed the Ed25519 signature payload format (V2 → V3)
- The TUI (2026.2.26) was trying to authenticate against a gateway (2026.2.22-2) with an incompatible signature format

**Fix:** Update OpenClaw to 2026.3.2 and restart the gateway so all components are on the same version. The device signature error was a version mismatch, not a Clawchestra bug.

## Shipping to Other Users: Version Compatibility

For first-friend-readiness and beyond, we need to handle these scenarios:

### Scenario 1: User has no OpenClaw installed
- Agent detection returns `available: false` for `openclaw-tui`
- Terminal type picker doesn't show the option
- **No action needed** — already handled by `detect_agents`

### Scenario 2: User has OpenClaw but gateway isn't running
- TUI launches but can't connect → shows connection error in the terminal pane
- **Desired:** Detect gateway status before launching; show a helpful message if gateway is down
- **Implementation:** Ping `ws://127.0.0.1:{port}` before spawning TUI. If unreachable, show "OpenClaw gateway not running. Start it with `openclaw gateway start`" in the terminal pane instead of launching TUI.

### Scenario 3: Version mismatch between CLI and gateway
- This is what caused the device signature error
- **Detection:** Compare `openclaw --version` output with the gateway's `OPENCLAW_SERVICE_VERSION`
- **If mismatched:** Show a warning before launching: "OpenClaw CLI (v2026.3.2) and gateway (v2026.2.22) are different versions. This may cause auth errors. Restart your gateway with `openclaw gateway restart`."
- **Implementation:** Add a `detect_openclaw_version` Tauri command that runs `openclaw --version` and returns the version string. Compare against the gateway version from the WebSocket connect response.

### Scenario 4: Another TUI instance already running
- Multiple TUI instances can coexist against the same gateway (they use separate sessions)
- Each TUI gets its own `sessionKey` (e.g., `agent:main:clawchestra:tui-{chatId}`)
- **No conflict** — but we should use distinct session keys per terminal tab to avoid session collisions

### Scenario 5: User is on an old OpenClaw version
- The `openclaw tui` subcommand may not exist in very old versions
- **Detection:** After detecting `openclaw` binary, check if `openclaw tui --help` returns successfully
- **If absent:** Don't show the TUI option; show "OpenClaw TUI requires version 2026.x.x or later"

### Scenario 6: Device needs re-pairing after gateway update
- When a user runs `openclaw gateway install --force` (required after major updates because the LaunchAgent hardcodes the path to the old version), all device trust is invalidated
- Both the TUI and Clawchestra's own WebSocket connection silently fail — no error surfaced to the user
- The gateway holds a pending `repair` request that requires `openclaw devices approve --latest` from the terminal
- **This is the hardest failure mode for non-technical users** — there is zero in-app indication of what's wrong
- **Detection:** If the WebSocket connect handshake returns a device-auth or pairing-needed error, surface it in the UI
- **Desired:** Show "Device pairing required. Run `openclaw devices approve --latest` in your terminal." in the connection status area, not buried in logs
- **Broader lesson:** This applies to Clawchestra's own connection, not just the TUI. The version detection roadmap item should include connection failure diagnostics

## Implementation Plan: Version Detection Layer

### Phase 1: Version detection (prerequisite for robust TUI)

1. **New Tauri command: `detect_openclaw_version`**
   - Runs `openclaw --version` via login shell (same `login_which` pattern)
   - Returns version string or null if not available

2. **Gateway version from connect response**
   - The WebSocket connect handshake response likely includes gateway version
   - Store it in the dashboard store for comparison

3. **Version comparison utility**
   - Parse `YYYY.M.DD` version strings
   - Compare CLI vs gateway versions
   - Flag mismatches in the UI (warning badge on TUI terminal option)

### Phase 2: Pre-launch checks

1. Before spawning `openclaw tui`, check:
   - Gateway reachable? (ping WebSocket)
   - Version mismatch? (CLI vs gateway)
   - TUI subcommand available? (`openclaw tui --help`)
2. If any check fails, show an actionable message in the terminal pane instead of a broken TUI

### Phase 3: Session key isolation

- Each TUI terminal tab uses a unique session key: `agent:tui:clawchestra:{chatId}`
- Prevents session collisions between multiple TUI instances and the sidebar chat
- Session key passed as env var or CLI flag when launching `openclaw tui`

## Relationship to Other Roadmap Items

- **OpenClaw Version Detection** (`openclaw-version-detection`): Overlaps — the version detection work here could be folded into that item or shared
- **First Friend Readiness** (`first-friend-readiness`): The version compatibility layer directly supports FFR Stage 4 (tool detection)
- **Chat Stop Button** (`chat-abort-button`): The TUI has its own stop mechanism; the stop button only applies to the sidebar/hub chat, not terminal panes
