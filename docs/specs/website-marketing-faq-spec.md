# Website Marketing FAQ

> Add an on-brand FAQ section to clawchestra.ai answering 5-6 questions about what Clawchestra is and how it works.

## Questions & Answers

**What is Clawchestra?**
A desktop project command centre combining a kanban board, AI planning assistant, and coding agent integration. Built for developers who want to plan and ship without context-switching.

**How is it different from Notion or Linear?**
Runs entirely on your machine — no cloud sync, no accounts, no subscription. Your projects are local files. The AI reads your specs and plans and knows your actual project state.

**How does the AI work?**
Connects to Claude via OpenClaw (a local AI gateway). Chat scoped to a project gives the AI full context — specs, roadmap, current status.

**Can I use my own coding agent?**
Yes. Supports Claude Code, Codex, OpenCode, and any generic shell. Terminals open scoped to a project or roadmap item.

**Does my data leave my machine?**
Only AI inference calls leave the machine. Project files stay on disk. OpenClaw runs locally by default.

**What platforms does it support?**
macOS (Apple Silicon + Intel), Windows, and Linux.

## Design Notes

- Match existing site font and colour palette
- `<details>/<summary>` accordion — no JS required
- Position after feature sections, before footer CTA
- Answers: 2–3 sentences max
