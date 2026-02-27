---
title: Terminal Agent Detection Fixes
id: terminal-agent-detection-fixes
status: pending
tags: [bug, terminal, claude-code, codex, hub]
icon: "🐛"
nextAction: "Investigate agent detection logic; reproduce both bugs; fix"
lastActivity: "2026-02-27"
---

# Terminal Agent Detection Fixes

Two related bugs affecting the terminal type picker and session launch.

---

## Bug 1 — Claude Code not appearing as a terminal type option

**Symptom:** When opening a new terminal chat, Claude Code does not appear as a selectable button/option in the type picker, even when `claude` is installed and on PATH.

**Likely cause:** The agent detection logic (`detectedAgents` in the store) is either:
- Not finding the `claude` binary (PATH issue in Tauri's sandboxed environment)
- Filtering it out due to a mismatch between expected binary name and actual name (`claude` vs `claude-code` vs `claude-3`)
- `available: false` being set despite the binary existing

**Investigation steps:**
1. Find where `detectedAgents` is populated — likely in a Tauri command or store initialisation
2. Log what binary names/paths are being checked for Claude Code
3. Check if Tauri's shell environment has the same PATH as the user's shell (it often doesn't — `~/.zshrc` may not be sourced)
4. Confirm what `agentType` string is expected for Claude Code vs what's being emitted

---

## Bug 2 — Codex terminal opens blank (Codex not running)

**Symptom:** Selecting Codex as the terminal type creates a terminal pane, but the pane is blank — Codex is not actually running inside it. User sees an empty shell instead of a Codex session.

**Likely cause:**
- The launch command for Codex is incorrect or the binary name/path doesn't match what's installed (`codex` vs `openai-codex` vs npx invocation)
- The command runs but immediately exits (missing env vars, auth not set up, wrong working directory)
- Tauri shell PATH issue — same as Bug 1; `codex` may not be on the sandboxed PATH

**Investigation steps:**
1. Find where terminal launch commands are constructed — look for where `agentType === 'codex'` maps to a shell command
2. Check what command is actually being spawned (add logging or surface it in the UI)
3. Test running the same command manually in the user's shell to confirm it works
4. If it's a PATH issue: resolve by sourcing the user's shell profile or using absolute paths

---

## Shared Notes

Both bugs are likely related to **PATH resolution in Tauri's sandboxed shell environment**. Tauri does not source `~/.zshrc` or `~/.bashrc` by default, so binaries installed via `nvm`, `brew`, `npm global`, etc. may be invisible. The fix pattern is to use the user's login shell to resolve paths: `zsh -l -c "which claude"` rather than a bare `which claude`.
