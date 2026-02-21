# Smart Project Import

> AI-driven migration from external planning tools into Clawchestra — no custom parsers, all intelligence in OpenClaw.

## Summary

Users have planning data scattered across tools (Notion, Trello, Linear, Apple Notes, TODO.md files). Clawchestra needs to bring this data in without implementing custom parsers for each tool. OpenClaw handles all format parsing and data extraction. Clawchestra provides the UI entry points and picks up the result via the state.json watcher.

## Three Import Paths

### Path B — Scan Existing Project Docs

OpenClaw reads README, PLAN.md, roadmap/, docs/, TODO.md, and any planning markdown in the project directory.

Prompt template:
```
Scan {project_path}. Find planning documentation. Build a Clawchestra
roadmap from what you find. Write the result to .clawchestra/state.json.

Schema: [embedded state.json schema]
```

OpenClaw walks the directory, identifies planning artifacts, extracts items, statuses, and priorities, then writes a valid state.json. The watcher picks it up automatically.

### Path C — Import from Tool Export

User picks an export file from their tool of choice:
- Notion: CSV or Markdown export
- Trello: JSON export
- Linear: CSV export
- Jira: XML export
- Any other structured format

Clawchestra reads the file content and passes it to OpenClaw chat pre-seeded with:
```
Parse this export from [tool]. Map items to the Clawchestra roadmap schema.
Write the result to .clawchestra/state.json.

Schema: [embedded state.json schema]

File content:
{file_content}
```

File picker uses `tauri::dialog::FileDialogBuilder::pick_file`. File content is read via the existing `read_file` command.

### Path D — Guided Blank Start

Opens a scoped OpenClaw chat session:
```
Let's set up your project roadmap. Tell me what you're working on and
what the major milestones are. I'll create your Clawchestra roadmap.

I'll ask clarifying questions to understand your project structure,
then write the result to .clawchestra/state.json.

Schema: [embedded state.json schema]
```

OpenClaw asks clarifying questions about the project, its phases, milestones, and priorities. Once it has enough context, it writes state.json.

## Result Pickup

The state.json watcher automatically detects and merges the AI-written file. No new backend infrastructure is needed. The existing validation pipeline handles partial or invalid writes gracefully:
- Valid fields are applied
- Invalid fields are rejected with warnings
- Missing required fields get defaults (status → pending)

## UI Entry Points

### Add Project Dialog

New "Import existing planning data" collapsible section with three buttons:
- "Scan project docs" → triggers Path B
- "Import from file" → opens file picker, triggers Path C
- "Start from scratch with AI" → opens chat, triggers Path D

### Project Settings Modal

"Re-import / refresh from existing docs" option — re-runs Path B to pick up new planning docs added since initial import.

## Non-Goals

- Clawchestra implements no proprietary format parsers
- No direct API integration with external tools (no Notion API, no Trello API)
- No continuous sync with external tools (one-time import)
- Format intelligence lives entirely in OpenClaw

## Dependencies

- Phase 5: Add Project dialog must be updated for the new architecture
- Phase 6: state.json watcher must be active and OpenClaw chat must be wired
- OpenClaw must be connected and responsive for all three paths
