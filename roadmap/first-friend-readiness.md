# First Friend Readiness

Make Clawchestra installable, configurable, and usable by someone on Linux or Windows with their own OpenClaw instance.

## Key Deliverables
- Cross-platform foundation (paths, shell, title bar, build)
- Configurable gateway connection (local + remote via SSH/Tailscale)
- Onboarding wizard (guided first-run setup)
- Project scaffolding (generate PROJECT.md for existing repos)
- Adaptive lifecycle prompts (work without Claude Code/Compound Engineering)
- Settings sidebar panel

## Spec
See `docs/specs/first-friend-readiness-spec.md` for full analysis.

## Dependencies
- Deep Rename (session key, package name) — should happen before or during
- Sidebar Enhancements (settings panel) — partially subsumed

## Subsumes
- Configurable OpenClaw Integration (existing pending item)
- Parts of Sidebar Enhancements
