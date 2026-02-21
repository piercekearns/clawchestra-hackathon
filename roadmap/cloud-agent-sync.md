# Cloud Agent Sync

Phase 6 completion (extension install UI, sync triggers) plus cloud agent injection — enabling cloud agents (Claude Code web, Codex CLI) to read/write the Clawchestra roadmap via the OpenClaw HTTP API.

## Key Deliverables
- Extension auto-install on app launch (local OpenClaw)
- Extension version detection + "Update" button in Settings
- Sync trigger wiring (on-launch, on-close) in frontend
- CLAUDE.md injection update with remote API access instructions (D42)
- Bearer token management via OS keychain
- "Rotate bearer token" button in Settings > Advanced

## Spec
See `docs/specs/cloud-agent-sync-spec.md` for full analysis.

## Status
pending

## Dependencies
- Phase 5 frontend alignment (must be complete before wiring sync UI)
- Phase 4.1 update (injection content with cloud agent access block)
