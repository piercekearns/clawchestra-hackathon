# First Friend Readiness Phase 6 Research Pass 2

> Survey realistic off-the-shelf alternatives before committing Clawchestra to a custom Windows persistence implementation.

## Summary

This pass broadened the Phase 6 research beyond the Windows platform docs and beyond Clawchestra's current PTY stack. The conclusion is still the same: the best current direction is a Clawchestra-owned backend session manager built on the existing PTY layer. The main reason is not that Windows cannot do persistence. It can. The reason is that none of the realistic off-the-shelf options cleanly matches Clawchestra's product boundary without introducing a larger dependency, packaging, or environment assumption.

In other words: Windows persistence is possible and well-supported at the primitive level, but not handed to us as a ready-made Tauri product layer.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 6 - Windows Parity And Final FFR Verification`
**Status:** Research pass complete
**Created:** 2026-03-06

---

## Questions This Pass Answered

1. Does Windows itself force embedded terminals to be ephemeral? `No.`
2. Is there a turnkey Tauri plugin that appears to provide the full persistence product model we need? `Not found.`
3. Are there external multiplexers with credible Windows persistence stories? `Yes, but with meaningful product tradeoffs.`
4. Does that change the provisional recommendation from research pass 1? `No.`

## Findings

### 1. Windows itself is not the blocker

Microsoft's pseudoconsole docs make two important things clear:

1. ConPTY is the correct primitive for terminal hosting on Windows.
2. The host application owns I/O, threading, and lifecycle behavior.

Newer docs are even more explicit that the application's `HPCON` handle keeps the pseudoconsole session alive by default until ownership is released.

Implication:

1. Windows terminals are not inherently ephemeral.
2. They become ephemeral when the host application treats terminal lifetime as tied to the current UI attachment or chooses not to build detach/reattach semantics.

### 2. The current Tauri/PTy layer is necessary but not sufficient

The current Clawchestra stack already reaches ConPTY via `portable-pty` and `tauri-pty`.

What it gives us:

1. spawn
2. read
3. write
4. resize
5. kill

What it does not obviously give us as a product abstraction:

1. stable terminal session IDs
2. detach without kill
3. reattach/replay
4. bounded scrollback buffering for reconnect
5. session cleanup policy

So the plugin is PTY plumbing, not the persistence feature itself.

### 3. WezTerm is a credible proof of possibility, but not an obvious embed/dependency answer

WezTerm's official docs describe a real multiplexer with local/remote domains and client/server-style attach semantics.

That proves a robust Windows-native persistence story is achievable.

But as a dependency choice for Clawchestra, it implies:

1. adopting another terminal product's mux model
2. additional packaging/runtime assumptions
3. potential mismatch between Clawchestra's session model and the mux's domain model

Conclusion:

Useful benchmark, not an obvious default dependency.

### 4. Zellij is powerful, but its current Windows fit is not clean enough for this use case

Zellij's official features/docs show strong persistence, session management, and even a web client.

But the official installation docs say prebuilt binaries are made available each release for Linux and macOS, not Windows.

Conclusion:

1. Zellij is strong evidence that persistence is a real product layer, not just a PTY primitive.
2. It is not a clean first-friend Windows dependency choice for Clawchestra right now.

### 5. Custom Windows-native persistence products exist

Undying Terminal explicitly positions itself as Windows-native, ConPTY-based, persistent-session software with no WSL requirement.

That is useful evidence because it shows the capability is real.

But it is a standalone product with its own transport/server model, not a drop-in library for Clawchestra.

Conclusion:

This supports the technical feasibility of the Clawchestra-owned approach more than it argues for a direct dependency.

## Recommendation After Ecosystem Survey

The recommendation still stands:

1. Build a Clawchestra-owned persistent terminal manager in Rust.
2. Keep using the existing PTY stack.
3. Treat persistence as a product-level backend session-management feature.
4. Do not default to WSL.
5. Do not adopt an external mux as the default unless later implementation work shows the custom manager to be clearly too expensive.

## Why This Recommendation Still Wins

1. It aligns with the current architecture instead of replacing it.
2. It keeps the user experience inside Clawchestra instead of exposing a second product/mux mental model.
3. It avoids shipping a dependency whose Windows story is incomplete or awkward.
4. It preserves the option to compare against external muxes later if implementation cost rises.

## Residual Uncertainty

This pass was broad enough to make the current recommendation credible, but it still is not a claim that every possible project in the ecosystem has been ruled out.

The right interpretation is:

1. enough evidence exists to proceed with the backend-owned design confidently
2. if implementation friction becomes higher than expected, WezTerm-style or other mux-backed approaches remain valid fallback comparisons

## Sources Used

1. Microsoft Pseudoconsoles overview
2. Microsoft Creating a Pseudoconsole Session
3. Microsoft ClosePseudoConsole
4. Microsoft ReleasePseudoConsole
5. WezTerm multiplexing docs
6. Zellij features docs
7. Zellij installation docs
8. Undying Terminal public docs/site
