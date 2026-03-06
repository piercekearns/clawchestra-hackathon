# First Friend Readiness Phase 4 Closeout

> Finish the remaining runtime/setup productization work around terminals, defaults, and remote OpenClaw setup.

## Summary

Phase 4 tightened the last product-facing runtime surfaces before website work. Terminal creation now better reflects the user's real environment instead of assuming one coding agent or a tmux-first happy path, and remote OpenClaw sync setups now have a guided one-command install path instead of only raw copied extension content.

---

**Roadmap Item:** `first-friend-readiness`
**Phase:** `Phase 4 - Terminal Readiness And Default Lifecycle Behavior`
**Status:** Built — awaiting verification
**Created:** 2026-03-06

---

## Shipped

1. Added a remote OpenClaw support helper that generates a single copyable shell install script for remote sync hosts.
2. Exposed that remote install command in Settings when remote sync is configured, with the existing manual extension copy path preserved as fallback.
3. Updated the terminal picker to:
   - distinguish temporary fallback from installable tmux remediation
   - stop showing `Install tmux` on Windows
   - surface available and missing coding-agent CLIs explicitly
   - recommend the sole available agent, or generic shell if no agent CLI is installed
4. Updated lifecycle prompts so the fallback path is explicit: if no coding-agent terminal is available, use a generic shell terminal or work directly in the repo.
5. Expanded onboarding terminal-readiness guidance to include detected coding-agent availability, not just tmux status.

## Validation

1. `npx tsc --noEmit`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `pnpm build`
4. `bun test src/lib/openclaw-support.test.ts src/lib/deliverable-lifecycle.test.ts src/lib/terminal-launch.test.ts src/lib/chat-normalization.test.ts src/lib/chat-message-identity.test.ts src/lib/gateway.test.ts`
5. `npx tauri build --no-bundle`

## Non-Goals / Carry-Forwards

1. The remote OpenClaw install command is POSIX-shell oriented. A dedicated Windows-host remote installer path was not built in Phase 4.
2. Remote OpenClaw self-install via OpenClaw itself was not built; the productized FFR path remains user-run command plus in-app verification.
3. True Windows terminal persistence still does not exist; Windows remains on temporary PowerShell sessions for now. This remains an explicit FFR completion gap for honest Windows-readiness claims unless the Windows support claim is narrowed. It is now carried into the final FFR phase rather than treated as Phase 5 website work. Research and design notes live in `docs/specs/windows-terminal-persistence-spec.md`.
4. Real Windows/Linux friend-testing remains deferred to the broader FFR verification pass.

## Exit Criteria Check

1. User can create a terminal immediately or remediate with one click. `Met locally for current supported paths.`
2. Cross-platform dependency guidance is OS-appropriate. `Met locally; Windows no longer pretends tmux install is the path.`
3. Lifecycle defaults no longer hard-fail for non-Claude/tmux users. `Met locally.`
4. Terminals remain part of the default Clawchestra product promise. `Met locally.`
5. Remote OpenClaw users have an explicit supported setup path beyond raw manual file editing. `Met locally via copyable one-command install plus fallback manual path.`
