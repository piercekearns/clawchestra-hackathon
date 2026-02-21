# OpenClaw Onboarding Gateway

Make Clawchestra a gateway to installing and setting up OpenClaw for users who don't already have it — turning the app's onboarding into a distribution channel for OpenClaw.

## Context

Clawchestra depends on OpenClaw for AI chat, project state sync, and cross-device access. Currently, the FFR onboarding wizard (Stage 2) handles "connect to your existing OpenClaw" — but what about users who don't have OpenClaw at all?

This item covers the "I don't have OpenClaw yet" path: guiding the user through installation, configuration, and first connection — all from within Clawchestra's onboarding wizard.

## Key Deliverables

- "Do you have OpenClaw?" fork in onboarding wizard
- If no: guided install flow (platform-specific instructions, link to installer, progress tracking)
- OpenClaw CLI onboarding facilitation (or embedding relevant steps)
- Auto-detection of OpenClaw config after install (scan for `~/.openclaw/openclaw.json`)
- Connection handshake and verification
- Fallback: "Skip for now" with degraded mode (no AI, no sync, local-only kanban)

## Design Principles

- Non-developer friendly: assume the user has never used a terminal
- Platform-aware: macOS/Linux/Windows each have different install paths
- The wizard does the work, not the user: minimize copy-paste, maximize auto-detection
- If OpenClaw can be installed via a one-click installer (future), integrate that directly

## Relationship to Other Items

- **Depends on:** first-friend-readiness (onboarding wizard must exist first)
- **Depends on:** architecture-direction (OpenClaw integration model must be established)
- **Informs:** "Login with OpenClaw" cross-platform identity model (see architecture-direction spec Section 13)

## Open Questions

1. Can OpenClaw installation be fully automated from within Clawchestra? (e.g., `npm i -g openclaw` triggered by the app)
2. What's the minimum viable OpenClaw setup for Clawchestra to function? (Just the gateway? Or also model provider config?)
3. Should Clawchestra offer a "hosted OpenClaw" option for users who don't want to self-host? (Future consideration — changes the business model)
