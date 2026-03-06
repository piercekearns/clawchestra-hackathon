# Windows Terminal Persistence Research Brief

> Research and choose the right Windows-native persistence architecture before claiming terminal parity inside First Friend Readiness.

## Summary

Clawchestra currently gives macOS and Linux users tmux-backed terminal persistence, but Windows users only get temporary direct PowerShell sessions. That is usable for alpha testing, but it is not honest parity if Clawchestra claims Windows is fully first-friend ready. This item exists to force a research-first architecture decision, grounded in primary-source evidence, before implementation starts.

The key constraint is that Windows does not hand us a built-in `tmux` equivalent. Microsoft provides the ConPTY pseudoconsole primitive, which is enough to host terminal processes, but persistence and reattachment are Clawchestra responsibilities unless we intentionally adopt another mux/runtime layer. This means the problem is larger than a UI tweak and should not be implemented from intuition alone.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Supporting research brief
**Created:** 2026-03-06

---

## Problem

Current terminal behavior is materially different across operating systems:

1. macOS/Linux terminals can survive UI-level interruption because Clawchestra reattaches to named `tmux` sessions.
2. Windows terminals launch as direct PowerShell processes without a persistence manager.
3. A Windows user can use terminals, but they cannot rely on the same resumable long-running-session behavior.

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

## Acceptance Criteria

This item is ready to leave research mode only when:

1. A concrete architecture has been selected with written reasoning.
2. The rejected options are documented with explicit tradeoffs.
3. The testing strategy for Windows validation is defined.
4. The FFR docs are updated so Windows-readiness claims match reality.

## Primary Source Starting Points

1. Microsoft CreatePseudoConsole API docs:
   - https://learn.microsoft.com/en-us/windows/console/createpseudoconsole
2. Microsoft ConPTY introduction:
   - https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/
3. WezTerm multiplexing/client-server docs:
   - https://wezterm.org/multiplexing.html
