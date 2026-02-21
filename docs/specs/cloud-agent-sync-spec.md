# Cloud Agent Sync

> Extension installation UI, sync trigger wiring, and cloud agent injection for remote roadmap access.

## Summary

Completes Phase 6 of the architecture direction plan and adds cloud agent support (D42). Cloud agents (Claude Code web, Codex CLI) can read and write the Clawchestra roadmap via OpenClaw's HTTP API when `.clawchestra/state.json` is not available on the filesystem.

## Extension Installation

### Settings > OpenClaw

- "Install / Update Extension" button
- Calls `install_openclaw_extension` Tauri command (already implemented in sync.rs)
- Shows current extension version
- "Update" button appears when installed version is stale

### Auto-Detection on Launch

On app launch:
1. Check if `~/.openclaw/extensions/clawchestra-data-endpoint.ts` exists
2. If missing: auto-install for local OpenClaw, show one-time toast "OpenClaw extension installed"
3. If exists: read `EXTENSION_VERSION` constant from the file
4. If version is older than expected: auto-update for local, show toast "OpenClaw extension updated"
5. For remote OpenClaw: prompt user rather than auto-installing

## Sync Trigger Wiring

### On Launch

Frontend calls `sync_on_launch()` after `clawchestra-ready` event if sync mode is not Disabled.

The function already exists in sync.rs:
1. Read local db.json
2. Read remote db.json (filesystem for local, HTTP for remote)
3. Per-field HLC merge
4. Write merged result to both locations
5. Emit updated state to frontend

### On Close

Before window close, call `sync_on_close()` with 3-second timeout:
1. Drain pending watcher events
2. Flush current DB state to remote
3. Use atomic write (write to .tmp, rename)
4. If sync fails: set `_syncFailedOnClose` flag, close anyway

Both functions already exist in sync.rs — this work is frontend event handling wiring.

## CLAUDE.md Injection Update (D42)

Add to the injected CLAUDE.md content (after the "Do NOT edit:" block):

```markdown
**Remote access (cloud environments):**
If `.clawchestra/state.json` is not available (cloud agent, CI, different device),
access the project database via the OpenClaw data API:
- GET  {openclaw_url}/clawchestra/data/db.json
- PUT  {openclaw_url}/clawchestra/data/db.json (full document replace)
- Authorization: Bearer {bearer_token}

When writing via PUT: read first, modify only this project's entry
(projects.{project_id}.*), increment _hlcCounter by 1, set __updatedAt
to Date.now() for each changed field, then PUT the full document back.
```

### Injection Logic

- `{openclaw_url}` = `settings.openclaw_remote_url` or `http://127.0.0.1:18789`
- `{bearer_token}` = from OS keychain; if public repo, use `[Contact project owner]`
- Public repo detection: `git remote get-url origin` → call GitHub API `GET /repos/{owner}/{repo}` → check `"private"` field

## Bearer Token Security

### Private repos
Token in CLAUDE.md is acceptable — the token is a secret in a private repo, which is standard practice (same as .env files in private repos).

### Public repos
Placeholder only: `[Contact project owner]`. The user shares the actual token out-of-band (e.g., Slack, email).

### Token Rotation
Settings > Advanced: "Rotate bearer token" button
1. Generate new UUID v4
2. Store in OS keychain (replacing old token)
3. Re-run branch injection to update CLAUDE.md on all branches
4. Update the OpenClaw extension's settings.json with the new token

## Testing

### Extension auto-install
1. Fresh launch with local OpenClaw running, no extension installed
2. Verify extension file is created at `~/.openclaw/extensions/clawchestra-data-endpoint.ts`
3. Verify toast notification shown

### Cloud agent read/write
1. Cloud agent sends `GET /clawchestra/data/db.json` with bearer token
2. Verify response contains current project data
3. Cloud agent modifies a field, sends `PUT` with updated document
4. On next Clawchestra launch, verify sync picks up the change
5. Verify UI reflects the cloud agent's modification

### Sync triggers
1. Launch app with sync enabled → verify `sync_on_launch` fires
2. Close app → verify `sync_on_close` fires within 3s timeout
3. Close app with sync failure → verify `_syncFailedOnClose` flag set
4. Relaunch after sync failure → verify higher-priority sync attempt
