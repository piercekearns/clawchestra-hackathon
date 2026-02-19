# Custom Card Actions (User-Defined Commands)

Replace the hardcoded 5-button lifecycle bar on roadmap cards with user-configured actions.

## Design Decisions (from Pierce, 2026-02-19)

- **0 to N buttons** — not fixed at 5. User adds buttons one-by-one. If none configured, no buttons show on hover.
- **Max ~5-6 buttons** — constrained by card width. Exact max determined by minimum button width at card min-width.
- **Left-aligned** — button 1 always in slot 1, button 2 in slot 2, etc. Predictable positioning regardless of count.
- **Per-button configuration:**
  - Icon (from lucide library picker)
  - Label (short name, e.g., "Build", "Review")
  - Prompt template (what gets prefilled in chat bar when clicked)
  - Optional: slash command prefix
- **Prompt template variables:** `{project.title}`, `{item.title}`, `{item.specDoc}`, `{item.planDoc}`, `{item.id}`, etc.
- **Configuration surface:** Sidebar settings panel (built by First Friend Readiness)
- **If no buttons configured:** Lifecycle action bar hidden on hover. Cards still show other hover actions (if any).

## Dependencies
- First Friend Readiness (provides sidebar settings panel + tool detection)
- Tool detection results inform which commands/prompts to suggest as defaults

## Relationship to FFR
- FFR ships with 5 hardcoded buttons + adaptive prompts as a working interim
- This item replaces the hardcoded buttons with the configurable system
- The hardcoded 5 could become "suggested defaults" during first-time button setup

## Open Questions
- Should there be a "suggested actions" preset? (e.g., "Import standard lifecycle actions" → creates the 5 buttons with appropriate prompts based on detected tools)
- How does the prompt template editor work? Plain text area with variable insertion, or something more structured?
- Do buttons apply globally or per-project? (Probably global, but worth asking)
