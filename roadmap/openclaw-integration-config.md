---
title: Configurable OpenClaw Integration
status: up-next
type: deliverable
priority: 5
parent: clawchestra
lastActivity: 2026-02-12
tags: [integration, config, sharing]
dependsOn: [architecture-v2]
---

# Configurable OpenClaw Integration

Make the OpenClaw/chat integration modular so anyone can plug in their own OpenClaw instance.

## Problem

Currently the gateway connection is hardcoded — the app isn't decoupled from Pierce's OpenClaw config. A friend couldn't spin up the app and connect to their own OpenClaw.

## Requirements

- [ ] Settings UI to configure OpenClaw connection (URL, token, session key)
- [ ] First-run onboarding flow if no OpenClaw configured
- [ ] Graceful degradation — app works without OpenClaw (just no chat)
- [ ] Connection test / validation
- [ ] Persist config securely (Tauri secure storage)

## Notes

- Architecture V2 (MVP) shipped; this item is now unblocked.
- Consider: should this be in Settings dialog or a dedicated "Connect" flow?
- May need docs/guide for "how to connect your OpenClaw"
