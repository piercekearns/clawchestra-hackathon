# AI-Generated Commit Messages

> Replace programmatic commit messages in the Git Sync dialog with AI-generated messages that describe what changed and why.

**Status:** Pending  
**Item ID:** `ai-commit-messages`  
**Dependencies:** Git Sync Phase 2 (complete), rate-limit-resilience (for model routing)

---

## Problem

The Git Sync dialog auto-generates commit messages programmatically:
```
docs: update project docs (Clawchestra, Revival Fightwear) — ROADMAP.md
```

This tells you *what files* but not *what changed*. A developer (or agent) reviewing git history can't tell whether items were reordered, a new item was added, or a status changed. AI-generated messages would produce:
```
docs(roadmap): reprioritize rate-limit-resilience to pending, reorder git-branch-sync in up-next
```

## Approach

When the user opens the Git Sync dialog and files are selected for commit:

1. **Generate diff** — run `git diff` on the selected files (already have paths + status)
2. **Send to lightweight model** — Haiku or Sonnet (not Opus — this is a low-stakes task)
3. **Pre-fill commit message** — replace the programmatic message with the AI result
4. **User can edit** — the message field is already editable; AI just provides a better default
5. **Fallback** — if AI call fails (rate limit, timeout), keep the programmatic message

## Prompt Design

```
Generate a conventional commit message for this change.

Rules:
- First line: type(scope): description (max 72 chars)
- Types: feat, fix, docs, chore, refactor, style, test
- Scope: infer from files (roadmap, spec, plan, config, etc.)
- Be specific about what changed, not just which files
- If multiple projects changed, mention the most significant
- No AI attribution, no emoji, no body unless the change is complex

Diff:
{diff content}

Files: {file list with status}
Projects: {project names}
```

## Technical Notes

- **Model choice:** Use the cheapest available model. This is a ~100-token output from a small diff. Haiku-class is ideal.
- **Latency:** The AI call happens when the dialog opens (or when file selection changes), not on commit click. Pre-fill should feel instant.
- **Caching:** If the file selection hasn't changed, don't re-generate.
- **Token budget:** Cap diff at ~2000 tokens. For larger diffs, summarise with `--stat` + first 50 lines.
- **Model routing tie-in:** If rate-limit-resilience (Layer 3) ships smart model routing, commit messages should use the cheap model, not the build model.

## UX

- Small "✨ AI" badge next to the commit message field when AI-generated (vs programmatic fallback)
- Loading spinner in the message field while generating
- If user has already manually edited the message, don't overwrite with AI result
- Respect the existing `userEditedCommitRef` flag

## Out of Scope

- Auto-commit messages (the silent auto-commit for PROJECT.md/ROADMAP.md stays programmatic — no AI call for background operations)
- Commit message templates/conventions beyond conventional commits
- Multi-line commit bodies (keep it single-line for now)
