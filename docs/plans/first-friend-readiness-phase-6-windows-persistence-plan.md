# First Friend Readiness Phase 6 Windows Persistence Plan

> Implement Windows terminal persistence as a Clawchestra-owned backend session manager on top of the existing PTY stack.

## Summary

This plan translates the Phase 6 research outcome into an implementation path. The recommended direction is not to bolt on WSL, and not to ship an external mux as the default. Instead, Clawchestra should move terminal session ownership into the Rust backend, keep PTY-backed sessions alive independently of the UI, and let the frontend attach/detach using stable session IDs and buffered replay.

The design should improve Windows first, but the clean version is cross-platform: tmux can remain an optimization or compatibility layer on Unix, while Clawchestra grows a native persistent terminal model it owns itself.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 6 - Windows Parity And Final FFR Verification`
**Status:** In Progress
**Created:** 2026-03-06

---

## Goal

Close the gap between "Windows terminals are usable" and "Windows terminals are honestly first-friend ready" by making terminal persistence a Clawchestra capability rather than a Unix-only side effect of tmux.

## Current State

Implementation passes 1 and 2 are now built locally:

1. Windows terminals survive drawer close/reopen inside the running app.
2. Hidden-session capture and quit-guard participation now work through a Clawchestra-owned backend session manager.
3. A detached local host process now owns Windows sessions across full Clawchestra relaunch.
4. The remaining gap is real-machine Windows/Linux validation plus any fixes that testing surfaces.

## Non-Goals

1. Replacing tmux everywhere immediately.
2. Building a full terminal emulator framework from scratch.
3. Solving every possible remote terminal orchestration feature inside this phase.

## Architecture Direction

Build a backend-owned persistent terminal manager in Rust that:

1. creates PTY-backed sessions using the existing PTY stack
2. stores them in backend session state keyed by stable Clawchestra session IDs
3. buffers output for reconnect/replay
4. lets the frontend attach/detach without killing the underlying shell/agent process
5. applies the same product model across Windows and Unix, even if Unix can still use tmux as an implementation detail during transition

## Workstreams

### Workstream 1: Session Model

1. Define a stable `terminalSessionId` distinct from transient PTY handles.
2. Store per-session metadata:
   - chat ID
   - project ID
   - platform/runtime mode
   - launched command
   - created/last-attached/last-output timestamps
   - exit state
3. Decide where session metadata lives while the app is running and whether any subset needs persistence across app restart.

### Workstream 2: Rust Terminal Manager

1. Add a backend terminal manager module in `src-tauri`.
2. Wrap the current PTY/session primitives in Clawchestra-owned session objects.
3. Maintain:
   - PTY handle
   - child handle/kill handle
   - bounded scrollback buffer
   - subscriber list / output fanout
4. Separate "detach UI" from "kill session".
5. Add cleanup rules for:
   - explicit quit
   - process exit
   - app shutdown
   - optional idle reap

### Workstream 3: Frontend Attach/Detach

1. Replace the assumption that terminal lifetime equals the current `spawn(...)` attachment.
2. On open:
   - create session if missing
   - attach to existing session if present
3. On drawer close / component unmount:
   - detach from the session
   - do not kill the backend session unless the user explicitly ends it
4. On reopen:
   - replay the buffered scrollback
   - resume live streaming

### Workstream 4: Runtime Policy

1. Decide the relationship between tmux and the new backend model on macOS/Linux.
2. Recommended transition policy:
   - Windows uses the backend-owned persistence path first
   - Unix can keep tmux temporarily while the product model above it converges
3. Avoid shipping two user-visible persistence concepts.

### Workstream 5: Verification

1. Add local automated tests for session model and buffer behavior.
2. Validate on a real Windows machine:
   - create terminal
   - close drawer
   - reopen and reattach
   - relaunch app and reattach
   - explicit quit vs detach behavior
3. Validate Linux/macOS regression risk before widening rollout.

## Suggested Implementation Order

1. Backend session registry + metadata model
2. Output buffering + fanout
3. Attach/detach commands
4. Frontend integration in `TerminalShell`
5. Explicit quit vs detach UX cleanup
6. Detached-host relaunch design and implementation
7. Windows manual validation
8. Unix alignment / cleanup
9. Friend-testing checklist execution and findings triage

## Code Touch Map

1. `src-tauri/src/` new backend terminal-manager module(s)
2. `src-tauri/src/lib.rs` command registration
3. `src/components/hub/TerminalShell.tsx`
4. `src/lib/terminal-launch.ts`
5. `src/lib/tauri.ts`
6. potentially `src/lib/store.ts` for session-state tracking

## Exit Criteria

1. Windows terminals survive drawer close and re-open without restarting the underlying process.
2. Session lifetime is no longer tied to the current frontend PTY attachment.
3. Windows terminals survive a full app relaunch.
4. Explicit quit remains available and understandable.
5. The Windows support claim is materially stronger than the current temporary PowerShell fallback.
6. Remaining real-machine findings are documented and triaged.
