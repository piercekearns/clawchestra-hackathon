# Windows Terminal Persistence Research Brief

> Research and choose the right Windows-native persistence architecture before claiming terminal parity inside First Friend Readiness.

## Summary

Clawchestra currently gives macOS and Linux users tmux-backed terminal persistence, but Windows users only get temporary direct PowerShell sessions. That is usable for alpha testing, but it is not honest parity if Clawchestra claims Windows is fully first-friend ready. This item exists to force a research-first architecture decision, grounded in primary-source evidence, before implementation starts.

The key constraint is that Windows does not hand us a built-in `tmux` equivalent. Microsoft provides the ConPTY pseudoconsole primitive, which is enough to host terminal processes, but persistence and reattachment are Clawchestra responsibilities unless we intentionally adopt another mux/runtime layer. Implementation pass 1 proved that Clawchestra can own attach/detach inside the running app, and implementation pass 2 now extends that ownership across a full app relaunch through a detached local host process.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Supporting research brief
**Created:** 2026-03-06

---

## Problem

Current terminal behavior is materially different across operating systems:

1. macOS/Linux terminals can survive UI-level interruption because Clawchestra reattaches to named `tmux` sessions.
2. Windows terminals now survive drawer close/reopen inside the running app via a Clawchestra-owned backend session manager.
3. Real-machine Windows validation is still pending, even though the detached-host relaunch path is now built locally.

That is acceptable for early tester access. It is not acceptable as the long-term definition of "Windows-ready" if terminals remain part of the default Clawchestra product promise.

## Why This Needs Research First

This is not a simple "port the tmux code" task.

1. Windows does not treat ConPTY as a detached session multiplexer. It provides a pseudoconsole API, not a complete persistent session model.
2. Reattachment, lifecycle management, output buffering, process cleanup, and reconnect semantics would all become Clawchestra-owned behavior if we build natively on top of ConPTY.
3. Alternative approaches such as WSL+tmux or bundling another terminal multiplexer may trade implementation speed for worse product assumptions, packaging complexity, or weaker OS-native behavior.
4. The primary user constraint is strong: the project owner cannot personally validate the final Windows behavior on a daily basis, so the architecture choice needs a higher-than-usual evidence bar.

## Research Questions

Before implementation, answer these with primary sources and a prototype-quality understanding:

1. What are the exact lifecycle semantics of Windows ConPTY / pseudoconsole hosts?
2. Can Clawchestra safely support detach/reattach by owning terminal sessions in the Rust backend?
3. Is bundling an external mux/runtime on Windows more pragmatic than writing our own session manager?
4. What are the packaging, signing, and operational consequences of each option?
5. Which option gives the best user experience without turning Clawchestra into a fragile terminal-emulator fork?

## Candidate Architectures

### Option A: Backend-Owned Persistent PTY Manager

Clawchestra's Tauri backend owns Windows terminal sessions directly:

1. create/manage ConPTY-backed sessions
2. keep them alive independently of the UI
3. let the frontend attach/detach by session ID
4. persist session metadata and reconnect state

Pros:

1. Most product-correct architecture.
2. Keeps the user model inside Clawchestra rather than requiring extra host assumptions.
3. Gives the best chance of parity with the Unix tmux experience.

Cons:

1. Highest implementation complexity.
2. Requires deep Windows-specific testing.
3. Requires careful session buffering/cleanup design.

Current recommendation: likely best long-term direction, but only after research confirms the operational complexity is acceptable.

### Option B: Bundle Or Depend On An External Cross-Platform Mux

Use a separate mux/runtime layer rather than building persistence directly in Clawchestra.

Examples to investigate:

1. WezTerm mux/client-server model
2. another portable terminal/session runtime with a usable Windows story

Pros:

1. Potentially faster path if the runtime is mature.
2. May offload some session semantics.

Cons:

1. Adds packaging and operational complexity.
2. Risks turning Clawchestra into a wrapper around another terminal product.
3. May still require awkward install/bundle assumptions.

Current recommendation: research seriously, but treat as a comparative option rather than defaulting to it blindly.

### Option C: WSL + tmux

Require Windows users to run terminals through WSL and use the existing Unix-like persistence model.

Pros:

1. Reuses a familiar persistence strategy.
2. Lower core implementation cost.

Cons:

1. Assumes WSL is present and acceptable.
2. Changes the user's execution environment materially.
3. Not honest "works out of the box on Windows" behavior.

Current recommendation: reject as the default first-friend answer; only acceptable as an advanced fallback.

## Research Findings (Pass 1)

This first pass used primary platform documentation plus the actual PTY stack already inside Clawchestra.

### What the platform evidence says

1. Microsoft's pseudoconsole APIs (`CreatePseudoConsole`, `ResizePseudoConsole`, `ClosePseudoConsole`) are PTY/session primitives, not a built-in persistence layer.
2. Microsoft's pseudoconsole session guidance explicitly frames the host as responsible for I/O channels and threading, which reinforces that detach/reattach semantics are application-owned rather than magically provided by the OS.
3. WezTerm's multiplexing docs confirm that a proper cross-platform mux is its own client/server system with local and remote domains, which is viable but materially changes Clawchestra's dependency and packaging surface.

### What Clawchestra's current stack says

1. Clawchestra already uses `tauri-pty`, whose backend stores PTY sessions in Rust and is built on top of `portable-pty`.
2. `portable-pty` already uses ConPTY on Windows, so Clawchestra does not need to invent or adopt a second PTY stack just to get onto the right Windows primitive.
3. The current gap is not \"we lack ConPTY\". The gap is that session ownership and reconnect semantics still live at the UI edge instead of in a Clawchestra-owned persistent terminal manager.
4. The current `tauri-pty` integration exposes spawn/read/write/resize/kill, but not a product-level session registry with attach/detach, buffered replay, or reconnect semantics for the frontend.

## Ecosystem Findings (Pass 2)

This pass widened the search from platform docs and current implementation details to realistic off-the-shelf alternatives.

### What the ecosystem evidence says

1. I did not find a turnkey Tauri plugin that clearly provides the full persistence product layer Clawchestra needs on Windows.
2. WezTerm's official docs show that a robust Windows-capable mux model is possible, but it comes as a full client/server-style multiplexer system rather than a tiny embedded helper.
3. Zellij's official docs show strong persistence/session capabilities, but the official install docs currently emphasize Linux and macOS binaries rather than a clean first-class Windows install story.
4. Windows-native persistent terminal products such as Undying Terminal are evidence that ConPTY-based persistence is feasible without WSL, but they are standalone products rather than drop-in Clawchestra dependencies.

### Conclusion after ecosystem survey

The ecosystem survey did not overturn the current recommendation.

1. Windows itself is not the blocker.
2. The missing layer is still product-level session ownership.
3. External mux/runtime options remain fallback comparisons, not clearly better defaults for FFR.

## Provisional Recommendation

The current front-runner is:

1. **Clawchestra-owned persistent terminal manager in Rust**
2. built on the existing PTY stack already in use (`tauri-pty` / `portable-pty`)
3. with Windows persistence implemented as a backend session-management feature, not as a UI trick and not as an external mux dependency

Why this is the best current direction:

1. It aligns with the current stack instead of replacing it.
2. It gives the cleanest user model across platforms: Clawchestra owns terminal sessions, the UI attaches/detaches from them, and persistence is a product behavior rather than a platform accident.
3. It avoids forcing WSL onto Windows users.
4. It avoids turning FFR into a packaging project for an entire external mux/runtime.

## Recommended Implementation Shape

The implementation plan should likely be:

1. Move terminal session ownership into the Rust backend.
2. Give each terminal a stable Clawchestra session ID independent of the frontend PTY attachment.
3. Keep the PTY process alive when the drawer closes or the UI detaches.
4. Stream output into:
   - a live subscriber channel for attached frontends
   - a bounded scrollback/ring buffer for reattach/replay
5. Add attach/detach commands for the frontend instead of treating terminal lifetime as equal to the current `spawn(...)` handle lifetime.
6. Add cleanup policy:
   - explicit user quit
   - app shutdown behavior
   - stale idle session reap rules
7. Validate the design on a real Windows machine before claiming parity.

## Recommended Process

1. Research from primary sources first.
2. Write a short decision memo comparing the candidate architectures against:
   - user experience
   - implementation complexity
   - packaging/distribution burden
   - testing burden
   - long-term maintainability
3. Only then write the implementation plan.
4. Do not claim Windows terminal parity in FFR completion language until this item is resolved or the Windows support claim is explicitly narrowed.

## Implementation Findings (Pass 3)

Implementation pass 1 changed the baseline:

1. Windows terminals no longer depend on a one-shot direct PTY attached to the current drawer mount.
2. Clawchestra now owns backend session state, output buffering, reattach, hidden-session capture, and quit-guard participation on Windows while the app remains open.
3. This validates the core architectural direction.
4. The remaining gap after pass 1 was specifically **detached-host relaunch persistence**, not attach/detach feasibility inside the app.

## Implementation Findings (Pass 4)

Implementation pass 2 moved the baseline forward again:

1. Windows sessions are now hosted by a detached local helper mode of the Clawchestra binary instead of the foreground app process.
2. The desktop app now reconnects to that host over a local authenticated IPC channel.
3. This means the intended Windows behavior is now parity with the tmux-backed Unix story for drawer close and full app relaunch.
4. The remaining gap is no longer architecture. It is verification:
   - real Windows-machine validation
   - real Linux-machine validation for the full FFR matrix
   - any fixes surfaced by that validation

## Acceptance Criteria

This item is ready to leave research mode only when:

1. A concrete architecture has been selected with written reasoning.
2. The rejected options are documented with explicit tradeoffs.
3. The implementation exists in code and the repo-side validation gates pass.
4. The testing strategy for Windows validation is defined.
5. The FFR docs are updated so Windows-readiness claims match reality.

## Primary Source Starting Points

1. Microsoft CreatePseudoConsole API docs:
   - https://learn.microsoft.com/en-us/windows/console/createpseudoconsole
2. Microsoft ConPTY introduction:
   - https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/
3. WezTerm multiplexing/client-server docs:
   - https://wezterm.org/multiplexing.html
